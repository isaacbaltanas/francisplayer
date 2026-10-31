import { useCallback, useEffect, useRef, useState } from 'react';
import { dbToGain, dbToLinear, normalizationAdjustmentDb } from '../lib/audio';
import { calculateGroupedDuckingDb } from '../lib/automation';
import { clipFadeGain, trackAutomationGain } from '../lib/clipGain';
import type { Arrangement, AudioSettings, AutomationState, LibraryTab, LoudnessMeterReading, MediaAsset, TimelineClip } from '../types';

interface PlayingElement {
  clipId: string;
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  ready: Promise<void>;
  cancel: () => void;
}

interface AudioGraph {
  context: AudioContext;
  input: GainNode;
  dry: GainNode;
  echoDelay: DelayNode;
  echoFeedback: GainNode;
  echoWet: GainNode;
  convolver: ConvolverNode;
  reverbWet: GainNode;
  meter: AudioWorkletNode | GainNode;
}

const contains = (clip: TimelineClip, positionMs: number) => positionMs >= clip.startMs && positionMs < clip.startMs + clip.durationMs;
const safeGain = (value: number) => Math.max(0, Math.min(8, value));
const normalizationGain = (asset: MediaAsset | undefined, settings: AudioSettings) => (
  settings.normalizeClips && asset?.analysis ? dbToLinear(normalizationAdjustmentDb(asset.analysis, settings)) : 1
);

const impulse = (context: AudioContext, duration: number, decay: number) => {
  const length = Math.max(1, Math.round(context.sampleRate * duration));
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) data[index] = (Math.random() * 2 - 1) * ((1 - index / length) ** decay);
  }
  return buffer;
};

const configureGraph = (graph: AudioGraph, settings: AudioSettings) => {
  graph.dry.gain.value = 1;
  graph.echoDelay.delayTime.value = (settings.echoDelayMs ?? 260) / 1000;
  graph.echoFeedback.gain.value = settings.echoEnabled ? Math.min(.9, (settings.echoFeedback ?? 30) / 100) : 0;
  graph.echoWet.gain.value = settings.echoEnabled ? (settings.echoMix ?? 15) / 100 : 0;
  graph.reverbWet.gain.value = settings.reverbEnabled ? (settings.reverbMix ?? 15) / 100 : 0;
  graph.convolver.buffer = impulse(graph.context, settings.reverbDuration ?? 1.8, settings.reverbDecay ?? 2.4);
};

const createGraph = async (onMeter: (reading: LoudnessMeterReading) => void): Promise<AudioGraph> => {
  const context = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' });
  const input = context.createGain();
  const dry = context.createGain();
  const echoDelay = context.createDelay(3);
  const echoFeedback = context.createGain();
  const echoWet = context.createGain();
  const convolver = context.createConvolver();
  const reverbWet = context.createGain();
  let meter: AudioWorkletNode | GainNode;
  try {
    await context.audioWorklet.addModule('./loudness-worklet.js');
    meter = new AudioWorkletNode(context, 'francis-loudness');
    meter.port.onmessage = event => onMeter(event.data as LoudnessMeterReading);
  } catch { meter = context.createGain(); }
  input.connect(dry).connect(meter);
  input.connect(echoDelay).connect(echoWet).connect(meter);
  echoDelay.connect(echoFeedback).connect(echoDelay);
  input.connect(convolver).connect(reverbWet).connect(meter);
  meter.connect(context.destination);
  return { context, input, dry, echoDelay, echoFeedback, echoWet, convolver, reverbWet, meter };
};

const createPlayingElement = (graph: AudioGraph, asset: MediaAsset, clip: TimelineClip, positionMs: number, gainValue: number) => {
  const element = new Audio();
  element.crossOrigin = 'anonymous';
  element.src = asset.previewUrl;
  element.preload = 'auto';
  const source = graph.context.createMediaElementSource(element);
  const gain = graph.context.createGain(); gain.gain.value = safeGain(gainValue);
  source.connect(gain).connect(graph.input);
  let cancelled = false;
  let readySettled = false;
  let settleReady = () => undefined;
  const ready = new Promise<void>(resolve => { settleReady = () => { if (!readySettled) { readySettled = true; resolve(); } }; });
  const start = async () => {
    if (cancelled) { settleReady(); return; }
    try {
      const targetTime = Math.max(0, (positionMs - clip.startMs) / 1000);
      if (targetTime > .01) {
        await new Promise<void>(resolve => {
          let settled = false;
          const finish = () => { if (!settled) { settled = true; element.removeEventListener('seeked', finish); resolve(); } };
          element.addEventListener('seeked', finish, { once: true });
          element.currentTime = targetTime;
          if (!element.seeking && Math.abs(element.currentTime - targetTime) < .02) finish();
          window.setTimeout(finish, 2_000);
        });
      } else element.currentTime = 0;
      if (cancelled) { settleReady(); return; }
      await element.play();
      if (cancelled) element.pause();
    } catch { /* A missing or unreadable clip must not lock the transport. */ }
    settleReady();
  };
  if (element.readyState >= HTMLMediaElement.HAVE_METADATA) void start(); else element.addEventListener('loadedmetadata', start, { once: true });
  const cancel = () => {
    cancelled = true;
    element.removeEventListener('loadedmetadata', start);
    element.pause(); element.removeAttribute('src'); element.load();
    source.disconnect(); gain.disconnect();
    settleReady();
  };
  return { clipId: clip.id, element, source, gain, ready, cancel };
};

export const useTimelinePlayer = (arrangement: Arrangement | null, assets: MediaAsset[], audioSettings: AudioSettings,
  automation: AutomationState | null, tabs: LibraryTab[] = []) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [musicGainDb, setMusicGainDb] = useState(audioSettings.musicGainDb);
  const [meter, setMeter] = useState<LoudnessMeterReading>({ momentary: -120, shortTerm: -120, integrated: -120, peakDbfs: -120 });
  const positionRef = useRef(0); const basePositionRef = useRef(0); const startedAtRef = useRef(0);
  const graphRef = useRef<AudioGraph | null>(null);
  const musicRef = useRef<Map<string, PlayingElement>>(new Map());
  const voicesRef = useRef<Map<string, PlayingElement>>(new Map());
  const playbackGenerationRef = useRef(0);

  const ensureGraph = useCallback(async () => {
    if (!graphRef.current) { graphRef.current = await createGraph(setMeter); configureGraph(graphRef.current, audioSettings); }
    const graph = graphRef.current;
    await graph.context.resume();
    return graph;
  }, [audioSettings]);

  useEffect(() => { if (graphRef.current) configureGraph(graphRef.current, audioSettings); }, [audioSettings]);

  const dispose = (item: PlayingElement) => item.cancel();
  const stopElements = useCallback(() => {
    musicRef.current.forEach(dispose); musicRef.current.clear(); voicesRef.current.forEach(dispose); voicesRef.current.clear();
  }, []);

  const mediaClockPosition = useCallback(() => {
    if (!arrangement) return null;
    const clips = new Map([...arrangement.music, ...arrangement.voice].map(clip => [clip.id, clip]));
    const current = [...musicRef.current.values(), ...voicesRef.current.values()]
      .find(item => !item.element.paused && item.element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
    const clip = current ? clips.get(current.clipId) : undefined;
    return current && clip ? clip.startMs + current.element.currentTime * 1000 : null;
  }, [arrangement]);

  const syncElements = useCallback(async (nextPositionMs: number, generation = playbackGenerationRef.current) => {
    if (!arrangement) return;
    const graph = await ensureGraph();
    if (generation !== playbackGenerationRef.current) return;
    const assetMap = new Map(assets.map(asset => [asset.id, asset]));
    const nextMusicGainDb = calculateGroupedDuckingDb(nextPositionMs, arrangement.voice, automation, audioSettings);
    const musicVolume = dbToGain(nextMusicGainDb);
    setMusicGainDb(current => Math.abs(current - nextMusicGainDb) > .05 ? nextMusicGainDb : current);
    const pending: Promise<void>[] = [];
    const sync = (clips: TimelineClip[], playing: Map<string, PlayingElement>, base: (clip: TimelineClip, asset: MediaAsset) => number) => {
      const active = clips.filter(clip => clip.assetId && contains(clip, nextPositionMs));
      const ids = new Set(active.map(clip => clip.id));
      playing.forEach((item, id) => { if (!ids.has(id)) { dispose(item); playing.delete(id); } });
      active.forEach(clip => {
        const asset = assetMap.get(clip.assetId!); if (!asset) return;
        const gainValue = base(clip, asset) * normalizationGain(asset, audioSettings) * clipFadeGain(clip, nextPositionMs)
          * trackAutomationGain(clip, tabs, nextPositionMs, arrangement.durationMs);
        const current = playing.get(clip.id);
        if (current) current.gain.gain.value = safeGain(gainValue);
        else {
          const created = createPlayingElement(graph, asset, clip, nextPositionMs, gainValue);
          playing.set(clip.id, created); pending.push(created.ready);
        }
      });
    };
    sync(arrangement.music.filter(clip => clip.kind === 'music'), musicRef.current, () => musicVolume);
    sync(arrangement.voice, voicesRef.current, () => dbToGain(audioSettings.voiceGainDb));
    await Promise.all(pending);
  }, [arrangement, assets, audioSettings, automation, ensureGraph, tabs]);

  const pause = useCallback(() => {
    playbackGenerationRef.current += 1;
    setIsPreparing(false); setIsPlaying(false); stopElements();
  }, [stopElements]);
  const stop = useCallback(() => {
    playbackGenerationRef.current += 1;
    setIsPreparing(false); setIsPlaying(false); stopElements(); positionRef.current = 0; basePositionRef.current = 0; setPositionMs(0); setMusicGainDb(audioSettings.musicGainDb);
    if (graphRef.current?.meter instanceof AudioWorkletNode) graphRef.current.meter.port.postMessage('reset');
    setMeter({ momentary: -120, shortTerm: -120, integrated: -120, peakDbfs: -120 });
  }, [audioSettings.musicGainDb, stopElements]);
  const play = useCallback(() => {
    if (!arrangement) return;
    playbackGenerationRef.current += 1;
    const generation = playbackGenerationRef.current;
    if (positionRef.current >= arrangement.durationMs) { positionRef.current = 0; setPositionMs(0); }
    stopElements(); setIsPlaying(false); setIsPreparing(true);
    void (async () => {
      try { await window.francisDesktop?.preparePreviews([...new Set(assets.map(asset => asset.path))]); } catch { /* Protocol fallback remains available. */ }
      if (generation !== playbackGenerationRef.current) return;
      await syncElements(positionRef.current, generation);
      if (generation !== playbackGenerationRef.current) return;
      basePositionRef.current = positionRef.current; startedAtRef.current = performance.now();
      setIsPreparing(false); setIsPlaying(true);
    })();
  }, [arrangement, assets, stopElements, syncElements]);
  const seek = useCallback((nextPositionMs: number) => {
    if (!arrangement) return;
    playbackGenerationRef.current += 1;
    const generation = playbackGenerationRef.current;
    const clamped = Math.min(arrangement.durationMs, Math.max(0, nextPositionMs));
    positionRef.current = clamped; basePositionRef.current = clamped; startedAtRef.current = performance.now(); setPositionMs(clamped); stopElements();
    if (isPlaying && clamped < arrangement.durationMs) void syncElements(clamped, generation);
  }, [arrangement, isPlaying, stopElements, syncElements]);

  useEffect(() => {
    if (!isPlaying || !arrangement) return;
    const timer = window.setInterval(() => {
      const now = performance.now();
      const mediaPosition = mediaClockPosition();
      const next = mediaPosition ?? basePositionRef.current + now - startedAtRef.current;
      if (next >= arrangement.durationMs) { stop(); return; }
      if (mediaPosition !== null) { basePositionRef.current = mediaPosition; startedAtRef.current = now; }
      positionRef.current = next; setPositionMs(next); void syncElements(next, playbackGenerationRef.current);
    }, 40);
    return () => window.clearInterval(timer);
  }, [arrangement, isPlaying, mediaClockPosition, stop, syncElements]);
  useEffect(() => { stop(); }, [arrangement]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { stopElements(); void graphRef.current?.context.close(); }, [stopElements]);

  return { isPlaying, isPreparing, positionMs, musicGainDb, meter, play, pause, stop, seek };
};
