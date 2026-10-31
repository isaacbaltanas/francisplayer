import { useCallback, useEffect, useRef, useState } from 'react';
import { dbToLinear, normalizationAdjustmentDb } from '../lib/audio';
import { calculateGroupedDuckingDb } from '../lib/automation';
import { clipFadeGain, trackAutomationGain } from '../lib/clipGain';
import { clipsInLookahead, technicalFadeWindow } from '../lib/playbackScheduling';
import { configureRealtimeAudioGraph, createRealtimeAudioGraph, smoothAudioGain, startAudioGain, type RealtimeAudioGraph } from '../lib/realtimeAudioGraph';
import type { Arrangement, AudioSettings, AutomationState, LibraryTab, LoudnessMeterReading, MediaAsset, TimelineClip } from '../types';

interface PlayingElement {
  clipId: string;
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  targetGain: number;
  ready: Promise<void>;
  cancel: () => void;
}

interface PlayingBuffer {
  clipId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  declick: GainNode;
  targetGain: number;
  release: () => void;
  cancel: () => void;
}

interface CachedVoiceBuffer {
  buffer: AudioBuffer;
  lastUsed: number;
}

const VOICE_LOOKAHEAD_MS = 15_000;
const VOICE_BUFFER_CACHE_LIMIT = 64;

const contains = (clip: TimelineClip, positionMs: number) => positionMs >= clip.startMs && positionMs < clip.startMs + clip.durationMs;
const safeGain = (value: number) => Math.max(0, Math.min(8, value));
const normalizationGain = (asset: MediaAsset | undefined, settings: AudioSettings) => (
  settings.normalizeClips && asset?.analysis ? dbToLinear(normalizationAdjustmentDb(asset.analysis, settings)) : 1
);

const createPlayingElement = (graph: RealtimeAudioGraph, asset: MediaAsset, clip: TimelineClip, positionMs: number, gainValue: number) => {
  const element = new Audio();
  element.crossOrigin = 'anonymous';
  element.src = asset.previewUrl;
  element.preload = 'auto';
  const source = graph.context.createMediaElementSource(element);
  const gain = graph.context.createGain();
  const targetGain = safeGain(gainValue);
  gain.gain.value = 0;
  source.connect(gain).connect(clip.kind === 'voice' ? graph.input : graph.output);
  let cancelled = false;
  let readySettled = false;
  let settleReady = () => undefined;
  const ready = new Promise<void>(resolve => { settleReady = () => { if (!readySettled) { readySettled = true; resolve(); } }; });
  const start = async () => {
    if (cancelled) { settleReady(); return; }
    try {
      const targetTime = Math.max(0, ((clip.sourceOffsetMs ?? 0) + positionMs - clip.startMs) / 1000);
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
      else startAudioGain(gain.gain, targetGain, graph.context);
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
  return { clipId: clip.id, element, source, gain, targetGain, ready, cancel };
};

const createPlayingBuffer = (
  graph: RealtimeAudioGraph,
  buffer: AudioBuffer,
  clip: TimelineClip,
  positionMs: number,
  gainValue: number
): PlayingBuffer | null => {
  const offsetMs = (clip.sourceOffsetMs ?? 0) + Math.max(0, positionMs - clip.startMs);
  const remainingMs = Math.min(
    clip.startMs + clip.durationMs - Math.max(positionMs, clip.startMs),
    buffer.duration * 1000 - offsetMs
  );
  if (remainingMs <= 0) return null;
  const source = graph.context.createBufferSource();
  source.buffer = buffer;
  const gain = graph.context.createGain();
  const declick = graph.context.createGain();
  const targetGain = safeGain(gainValue);
  source.connect(gain).connect(declick).connect(graph.input);
  const when = graph.context.currentTime + Math.max(0, clip.startMs - positionMs) / 1000;
  const technicalFade = technicalFadeWindow(when, remainingMs / 1000);
  gain.gain.setValueAtTime(targetGain, when);
  declick.gain.setValueAtTime(0, technicalFade.startTime);
  declick.gain.linearRampToValueAtTime(1, technicalFade.fadeInEndTime);
  declick.gain.setValueAtTime(1, technicalFade.fadeOutStartTime);
  declick.gain.linearRampToValueAtTime(0, technicalFade.endTime);
  source.start(when, Math.max(0, offsetMs) / 1000, remainingMs / 1000);
  let cancelled = false;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    source.disconnect(); gain.disconnect(); declick.disconnect();
  };
  return {
    clipId: clip.id, source, gain, declick, targetGain, release,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      try { source.stop(); } catch { /* Already stopped. */ }
      release();
    }
  };
};

export const useTimelinePlayer = (arrangement: Arrangement | null, assets: MediaAsset[], audioSettings: AudioSettings,
  automation: AutomationState | null, tabs: LibraryTab[] = []) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [musicGainDb, setMusicGainDb] = useState(audioSettings.musicGainDb);
  const [meter, setMeter] = useState<LoudnessMeterReading>({ momentary: -120, shortTerm: -120, integrated: -120, peakDbfs: -120 });
  const positionRef = useRef(0); const basePositionRef = useRef(0); const startedAtRef = useRef(0);
  const graphRef = useRef<RealtimeAudioGraph | null>(null);
  const musicRef = useRef<Map<string, PlayingElement>>(new Map());
  const voicesRef = useRef<Map<string, PlayingBuffer>>(new Map());
  const voiceBuffersRef = useRef<Map<string, CachedVoiceBuffer>>(new Map());
  const voiceBufferPromisesRef = useRef<Map<string, Promise<AudioBuffer | null>>>(new Map());
  const playbackGenerationRef = useRef(0);

  const ensureGraph = useCallback(async () => {
    if (!graphRef.current) { graphRef.current = await createRealtimeAudioGraph(setMeter); configureRealtimeAudioGraph(graphRef.current, audioSettings); }
    const graph = graphRef.current;
    await graph.context.resume();
    return graph;
  }, [audioSettings]);

  useEffect(() => { if (graphRef.current) configureRealtimeAudioGraph(graphRef.current, audioSettings); }, [audioSettings]);

  const dispose = (item: PlayingElement | PlayingBuffer) => item.cancel();
  const stopElements = useCallback(() => {
    musicRef.current.forEach(dispose); musicRef.current.clear(); voicesRef.current.forEach(dispose); voicesRef.current.clear();
  }, []);

  const mediaClockPosition = useCallback(() => {
    if (!arrangement) return null;
    const clips = new Map([...arrangement.music, ...arrangement.voice].map(clip => [clip.id, clip]));
    const current = [...musicRef.current.values()]
      .find(item => !item.element.paused && item.element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
    const clip = current ? clips.get(current.clipId) : undefined;
    return current && clip ? clip.startMs + current.element.currentTime * 1000 - (clip.sourceOffsetMs ?? 0) : null;
  }, [arrangement]);

  const decodeVoiceBuffer = useCallback(async (graph: RealtimeAudioGraph, asset: MediaAsset) => {
    const cached = voiceBuffersRef.current.get(asset.id);
    if (cached) { cached.lastUsed = performance.now(); return cached.buffer; }
    const pending = voiceBufferPromisesRef.current.get(asset.id);
    if (pending) return pending;
    const promise = (async () => {
      try {
        const response = await fetch(asset.previewUrl);
        if (!response.ok) return null;
        const buffer = await graph.context.decodeAudioData(await response.arrayBuffer());
        voiceBuffersRef.current.set(asset.id, { buffer, lastUsed: performance.now() });
        if (voiceBuffersRef.current.size > VOICE_BUFFER_CACHE_LIMIT) {
          const protectedIds = new Set([...voicesRef.current.keys()].map(clipId =>
            arrangement?.voice.find(clip => clip.id === clipId)?.assetId).filter(Boolean));
          const removable = [...voiceBuffersRef.current.entries()]
            .filter(([id]) => !protectedIds.has(id))
            .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
          while (voiceBuffersRef.current.size > VOICE_BUFFER_CACHE_LIMIT && removable.length) {
            voiceBuffersRef.current.delete(removable.shift()![0]);
          }
        }
        return buffer;
      } catch { return null; }
      finally { voiceBufferPromisesRef.current.delete(asset.id); }
    })();
    voiceBufferPromisesRef.current.set(asset.id, promise);
    return promise;
  }, [arrangement]);

  const preloadVoices = useCallback(async (positionMs: number, graph: RealtimeAudioGraph) => {
    if (!arrangement) return;
    const assetMap = new Map(assets.map(asset => [asset.id, asset]));
    const upcoming = clipsInLookahead(arrangement.voice, positionMs, VOICE_LOOKAHEAD_MS);
    await Promise.all(upcoming.map(clip => {
      const asset = assetMap.get(clip.assetId!);
      return asset ? decodeVoiceBuffer(graph, asset) : null;
    }));
  }, [arrangement, assets, decodeVoiceBuffer]);

  const syncElements = useCallback(async (nextPositionMs: number, generation = playbackGenerationRef.current) => {
    if (!arrangement) return;
    const graph = await ensureGraph();
    if (generation !== playbackGenerationRef.current) return;
    const assetMap = new Map(assets.map(asset => [asset.id, asset]));
    const nextMusicGainDb = calculateGroupedDuckingDb(nextPositionMs, arrangement.voice, automation, audioSettings);
    const musicVolume = dbToLinear(nextMusicGainDb);
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
        if (current) {
          const targetGain = safeGain(gainValue);
          if (Math.abs(current.targetGain - targetGain) > .0001) {
            current.targetGain = targetGain;
            smoothAudioGain(current.gain.gain, targetGain, graph.context);
          }
        }
        else {
          const created = createPlayingElement(graph, asset, clip, nextPositionMs, gainValue);
          playing.set(clip.id, created); pending.push(created.ready);
        }
      });
    };
    sync(arrangement.music.filter(clip => clip.kind === 'music'), musicRef.current, () => musicVolume);
    await Promise.all(pending);
    const voicePositionMs = mediaClockPosition() ?? nextPositionMs;
    positionRef.current = voicePositionMs;
    const upcomingVoices = clipsInLookahead(arrangement.voice, voicePositionMs, VOICE_LOOKAHEAD_MS);
    const registerVoice = (clipId: string, created: PlayingBuffer) => {
      voicesRef.current.set(clipId, created);
      created.source.onended = () => {
        created.release();
        if (voicesRef.current.get(clipId) === created) voicesRef.current.delete(clipId);
      };
    };
    upcomingVoices.forEach(clip => {
      const asset = assetMap.get(clip.assetId!); if (!asset) return;
      const samplePosition = Math.max(voicePositionMs, clip.startMs);
      const gainValue = dbToLinear(audioSettings.voiceGainDb) * normalizationGain(asset, audioSettings)
        * clipFadeGain(clip, samplePosition)
        * trackAutomationGain(clip, tabs, samplePosition, arrangement.durationMs);
      const current = voicesRef.current.get(clip.id);
      if (current) {
        if (voicePositionMs >= clip.startMs) {
          const targetGain = safeGain(gainValue);
          if (Math.abs(current.targetGain - targetGain) > .0001) {
            current.targetGain = targetGain;
            smoothAudioGain(current.gain.gain, targetGain, graph.context);
          }
        }
        return;
      }
      const buffer = voiceBuffersRef.current.get(asset.id)?.buffer;
      if (buffer) {
        voiceBuffersRef.current.get(asset.id)!.lastUsed = performance.now();
        const created = createPlayingBuffer(graph, buffer, clip, voicePositionMs, gainValue);
        if (created) registerVoice(clip.id, created);
        return;
      }
      void decodeVoiceBuffer(graph, asset).then(decoded => {
        if (!decoded || generation !== playbackGenerationRef.current || voicesRef.current.has(clip.id)) return;
        const currentPosition = positionRef.current;
        if (currentPosition >= clip.startMs + clip.durationMs || clip.startMs > currentPosition + VOICE_LOOKAHEAD_MS) return;
        const currentGain = dbToLinear(audioSettings.voiceGainDb) * normalizationGain(asset, audioSettings)
          * clipFadeGain(clip, Math.max(currentPosition, clip.startMs))
          * trackAutomationGain(clip, tabs, Math.max(currentPosition, clip.startMs), arrangement.durationMs);
        const created = createPlayingBuffer(graph, decoded, clip, currentPosition, currentGain);
        if (created) registerVoice(clip.id, created);
      });
    });
  }, [arrangement, assets, audioSettings, automation, decodeVoiceBuffer, ensureGraph, mediaClockPosition, tabs]);

  const holdPosition = useCallback(() => {
    const currentPosition = mediaClockPosition() ?? positionRef.current;
    positionRef.current = currentPosition;
    basePositionRef.current = currentPosition;
    startedAtRef.current = performance.now();
    setPositionMs(currentPosition);
    playbackGenerationRef.current += 1;
    setIsPreparing(false); setIsPlaying(false); stopElements();
  }, [mediaClockPosition, stopElements]);
  const pause = holdPosition;
  const stop = useCallback(() => {
    holdPosition();
    setMusicGainDb(audioSettings.musicGainDb);
    if (graphRef.current?.meter instanceof AudioWorkletNode) graphRef.current.meter.port.postMessage('reset');
    setMeter({ momentary: -120, shortTerm: -120, integrated: -120, peakDbfs: -120 });
  }, [audioSettings.musicGainDb, holdPosition]);
  const reset = useCallback(() => {
    playbackGenerationRef.current += 1;
    setIsPreparing(false); setIsPlaying(false); stopElements();
    positionRef.current = 0; basePositionRef.current = 0; startedAtRef.current = performance.now(); setPositionMs(0);
    setMusicGainDb(audioSettings.musicGainDb);
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
      const graph = await ensureGraph();
      await preloadVoices(positionRef.current, graph);
      if (generation !== playbackGenerationRef.current) return;
      await syncElements(positionRef.current, generation);
      if (generation !== playbackGenerationRef.current) return;
      basePositionRef.current = positionRef.current; startedAtRef.current = performance.now();
      setIsPreparing(false); setIsPlaying(true);
    })();
  }, [arrangement, assets, ensureGraph, preloadVoices, stopElements, syncElements]);
  const seek = useCallback((nextPositionMs: number) => {
    if (!arrangement) return;
    playbackGenerationRef.current += 1;
    const generation = playbackGenerationRef.current;
    const clamped = Math.min(arrangement.durationMs, Math.max(0, nextPositionMs));
    positionRef.current = clamped; basePositionRef.current = clamped; startedAtRef.current = performance.now(); setPositionMs(clamped); stopElements();
    if (isPlaying && clamped < arrangement.durationMs) void (async () => {
      const graph = await ensureGraph();
      await preloadVoices(clamped, graph);
      if (generation === playbackGenerationRef.current) await syncElements(clamped, generation);
    })();
  }, [arrangement, ensureGraph, isPlaying, preloadVoices, stopElements, syncElements]);

  useEffect(() => {
    if (!isPlaying || !arrangement) return;
    const timer = window.setInterval(() => {
      const now = performance.now();
      const mediaPosition = mediaClockPosition();
      const next = mediaPosition ?? basePositionRef.current + now - startedAtRef.current;
      if (next >= arrangement.durationMs) {
        positionRef.current = arrangement.durationMs; basePositionRef.current = arrangement.durationMs;
        setPositionMs(arrangement.durationMs); stop(); return;
      }
      if (mediaPosition !== null) { basePositionRef.current = mediaPosition; startedAtRef.current = now; }
      positionRef.current = next; setPositionMs(next); void syncElements(next, playbackGenerationRef.current);
    }, 40);
    return () => window.clearInterval(timer);
  }, [arrangement, isPlaying, mediaClockPosition, stop, syncElements]);
  useEffect(() => {
    if (!arrangement) { reset(); return; }
    pause();
    const clamped = Math.min(positionRef.current, arrangement.durationMs);
    positionRef.current = clamped; basePositionRef.current = clamped; setPositionMs(clamped);
  }, [arrangement]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    stopElements(); voiceBuffersRef.current.clear(); voiceBufferPromisesRef.current.clear();
    void graphRef.current?.context.close();
  }, [stopElements]);

  return { isPlaying, isPreparing, positionMs, musicGainDb, meter, play, pause, stop, reset, seek };
};
