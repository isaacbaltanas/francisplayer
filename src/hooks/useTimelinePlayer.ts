import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dbToLinear, normalizationAdjustmentDb } from '../lib/audio';
import { buildRealtimeDuckingPlan, calculateGroupedDuckingDb } from '../lib/automation';
import { clipFadeGain, trackAutomationGain } from '../lib/clipGain';
import { clipsInLookahead, technicalFadeWindow, voicePlaybackWindow } from '../lib/playbackScheduling';
import { configureRealtimeAudioGraph, createRealtimeAudioGraph, smoothAudioGain, type RealtimeAudioGraph } from '../lib/realtimeAudioGraph';
import type { Arrangement, AudioSettings, AutomationState, LibraryTab, LoudnessMeterReading, MediaAsset, TimelineClip } from '../types';

interface PlayingBuffer {
  clipId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  declick: GainNode;
  targetGain: number;
  release: () => void;
  cancel: () => void;
}

interface CachedAudioBuffer {
  buffer: AudioBuffer;
  lastUsed: number;
}

const VOICE_LOOKAHEAD_MS = 15_000;
const MUSIC_LOOKAHEAD_MS = 15_000;
const VOICE_BUFFER_CACHE_LIMIT = 64;
const MUSIC_BUFFER_CACHE_LIMIT = 3;

const safeGain = (value: number) => Math.max(0, Math.min(8, value));
const normalizationGain = (asset: MediaAsset | undefined, settings: AudioSettings) => (
  settings.normalizeClips && asset?.analysis ? dbToLinear(normalizationAdjustmentDb(asset.analysis, settings)) : 1
);

const createPlayingBuffer = (
  graph: RealtimeAudioGraph,
  buffer: AudioBuffer,
  clip: TimelineClip,
  positionMs: number,
  gainValue: number,
  output: AudioNode,
  includeVoicePostRoll = false
): PlayingBuffer | null => {
  const offsetMs = (clip.sourceOffsetMs ?? 0) + Math.max(0, positionMs - clip.startMs);
  const logicalRemainingMs = Math.min(
    clip.startMs + clip.durationMs - Math.max(positionMs, clip.startMs),
    buffer.duration * 1000 - offsetMs
  );
  if (logicalRemainingMs <= 0) return null;
  const source = graph.context.createBufferSource();
  source.buffer = buffer;
  const gain = graph.context.createGain();
  const declick = graph.context.createGain();
  const targetGain = safeGain(gainValue);
  source.connect(gain).connect(declick).connect(output);
  const when = graph.context.currentTime + Math.max(0, clip.startMs - positionMs) / 1000;
  const availablePostRollMs = Math.max(0, buffer.duration * 1000 - offsetMs - logicalRemainingMs);
  const playback = includeVoicePostRoll
    ? voicePlaybackWindow(when, logicalRemainingMs / 1000, availablePostRollMs / 1000)
    : { ...technicalFadeWindow(when, logicalRemainingMs / 1000), sourceDurationSeconds: logicalRemainingMs / 1000 };
  gain.gain.setValueAtTime(targetGain, when);
  declick.gain.setValueAtTime(0, playback.startTime);
  declick.gain.linearRampToValueAtTime(1, playback.fadeInEndTime);
  declick.gain.setValueAtTime(1, playback.fadeOutStartTime);
  declick.gain.linearRampToValueAtTime(0, playback.endTime);
  source.start(when, Math.max(0, offsetMs) / 1000, playback.sourceDurationSeconds);
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
  const audioClockPositionRef = useRef(0); const audioClockTimeRef = useRef(0); const audioClockRunningRef = useRef(false);
  const graphRef = useRef<RealtimeAudioGraph | null>(null);
  const musicRef = useRef<Map<string, PlayingBuffer>>(new Map());
  const voicesRef = useRef<Map<string, PlayingBuffer>>(new Map());
  const retiredMusicRef = useRef<PlayingBuffer[]>([]);
  const retiredVoicesRef = useRef<PlayingBuffer[]>([]);
  const musicBuffersRef = useRef<Map<string, CachedAudioBuffer>>(new Map());
  const voiceBuffersRef = useRef<Map<string, CachedAudioBuffer>>(new Map());
  const musicBufferPromisesRef = useRef<Map<string, Promise<AudioBuffer | null>>>(new Map());
  const voiceBufferPromisesRef = useRef<Map<string, Promise<AudioBuffer | null>>>(new Map());
  const playbackGenerationRef = useRef(0);
  const duckingConfigurationRef = useRef<{ generation: number; plan: object } | null>(null);
  const duckingPlan = useMemo(() => buildRealtimeDuckingPlan(arrangement?.voice ?? [], automation, audioSettings),
    [arrangement, automation, audioSettings]);

  const ensureGraph = useCallback(async () => {
    if (!graphRef.current) { graphRef.current = await createRealtimeAudioGraph(setMeter); configureRealtimeAudioGraph(graphRef.current, audioSettings); }
    const graph = graphRef.current;
    await graph.context.resume();
    return graph;
  }, [audioSettings]);

  useEffect(() => { if (graphRef.current) configureRealtimeAudioGraph(graphRef.current, audioSettings); }, [audioSettings]);

  const dispose = (item: PlayingBuffer) => item.cancel();
  const stopElements = useCallback(() => {
    musicRef.current.forEach(dispose); musicRef.current.clear(); voicesRef.current.forEach(dispose); voicesRef.current.clear();
    retiredMusicRef.current.forEach(item => item.release()); retiredMusicRef.current = [];
    retiredVoicesRef.current.forEach(item => item.release()); retiredVoicesRef.current = [];
  }, []);

  const audioClockPosition = useCallback(() => {
    const graph = graphRef.current;
    if (!graph || !audioClockRunningRef.current) return positionRef.current;
    return audioClockPositionRef.current + Math.max(0, graph.context.currentTime - audioClockTimeRef.current) * 1000;
  }, []);

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

  const decodeMusicBuffer = useCallback(async (graph: RealtimeAudioGraph, asset: MediaAsset) => {
    const cached = musicBuffersRef.current.get(asset.id);
    if (cached) { cached.lastUsed = performance.now(); return cached.buffer; }
    const pending = musicBufferPromisesRef.current.get(asset.id);
    if (pending) return pending;
    const promise = (async () => {
      try {
        const response = await fetch(asset.previewUrl);
        if (!response.ok) return null;
        const buffer = await graph.context.decodeAudioData(await response.arrayBuffer());
        musicBuffersRef.current.set(asset.id, { buffer, lastUsed: performance.now() });
        if (musicBuffersRef.current.size > MUSIC_BUFFER_CACHE_LIMIT) {
          const protectedIds = new Set([...musicRef.current.keys()].map(clipId =>
            arrangement?.music.find(clip => clip.id === clipId)?.assetId).filter(Boolean));
          const removable = [...musicBuffersRef.current.entries()]
            .filter(([id]) => !protectedIds.has(id))
            .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
          while (musicBuffersRef.current.size > MUSIC_BUFFER_CACHE_LIMIT && removable.length) {
            musicBuffersRef.current.delete(removable.shift()![0]);
          }
        }
        return buffer;
      } catch { return null; }
      finally { musicBufferPromisesRef.current.delete(asset.id); }
    })();
    musicBufferPromisesRef.current.set(asset.id, promise);
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

  const preloadMusic = useCallback(async (positionMs: number, graph: RealtimeAudioGraph) => {
    if (!arrangement) return;
    const assetMap = new Map(assets.map(asset => [asset.id, asset]));
    const upcoming = clipsInLookahead(arrangement.music.filter(clip => clip.kind === 'music'), positionMs, MUSIC_LOOKAHEAD_MS);
    await Promise.all(upcoming.map(clip => {
      const asset = assetMap.get(clip.assetId!);
      return asset ? decodeMusicBuffer(graph, asset) : null;
    }));
  }, [arrangement, assets, decodeMusicBuffer]);

  const syncElements = useCallback(async (nextPositionMs: number, generation = playbackGenerationRef.current) => {
    if (!arrangement) return;
    const graph = await ensureGraph();
    if (generation !== playbackGenerationRef.current) return;
    const assetMap = new Map(assets.map(asset => [asset.id, asset]));
    const nextMusicGainDb = calculateGroupedDuckingDb(nextPositionMs, arrangement.voice, automation, audioSettings);
    const musicVolume = dbToLinear(nextMusicGainDb);
    setMusicGainDb(current => Math.abs(current - nextMusicGainDb) > .05 ? nextMusicGainDb : current);
    const needsDuckingConfiguration = graph.sampleAccurateDucking
      && (duckingConfigurationRef.current?.generation !== generation || duckingConfigurationRef.current?.plan !== duckingPlan);
    const configureDucking = (positionMs: number) => {
      if (!graph.sampleAccurateDucking || !(graph.musicDucking instanceof AudioWorkletNode)) return;
      graph.musicDucking.port.postMessage({ type: 'configure', anchorContextTime: graph.context.currentTime,
        anchorPositionMs: positionMs, ...duckingPlan });
    };
    if (needsDuckingConfiguration) configureDucking(nextPositionMs);
    if (needsDuckingConfiguration) {
      duckingConfigurationRef.current = { generation, plan: duckingPlan };
    }
    const registerMusic = (clipId: string, created: PlayingBuffer) => {
      musicRef.current.set(clipId, created);
      created.source.onended = () => {
        if (musicRef.current.get(clipId) !== created) return;
        musicRef.current.delete(clipId);
        retiredMusicRef.current.push(created);
        window.setTimeout(() => {
          retiredMusicRef.current = retiredMusicRef.current.filter(item => item !== created);
          created.release();
        }, 1_000);
      };
    };
    const upcomingMusic = clipsInLookahead(
      arrangement.music.filter(clip => clip.kind === 'music'), nextPositionMs, MUSIC_LOOKAHEAD_MS
    );
    upcomingMusic.forEach(clip => {
      const asset = assetMap.get(clip.assetId!); if (!asset) return;
      const samplePosition = Math.max(nextPositionMs, clip.startMs);
      const baseGain = graph.sampleAccurateDucking ? 1 : musicVolume;
      const gainValue = baseGain * normalizationGain(asset, audioSettings)
        * clipFadeGain(clip, samplePosition)
        * trackAutomationGain(clip, tabs, samplePosition, arrangement.durationMs);
      const current = musicRef.current.get(clip.id);
      if (current) {
        if (nextPositionMs >= clip.startMs) {
          const targetGain = safeGain(gainValue);
          if (Math.abs(current.targetGain - targetGain) > .0001) {
            current.targetGain = targetGain;
            smoothAudioGain(current.gain.gain, targetGain, graph.context);
          }
        }
        return;
      }
      const buffer = musicBuffersRef.current.get(asset.id)?.buffer;
      if (buffer) {
        musicBuffersRef.current.get(asset.id)!.lastUsed = performance.now();
        const created = createPlayingBuffer(graph, buffer, clip, nextPositionMs, gainValue, graph.musicInput);
        if (created) registerMusic(clip.id, created);
        return;
      }
      void decodeMusicBuffer(graph, asset).then(decoded => {
        if (!decoded || generation !== playbackGenerationRef.current || musicRef.current.has(clip.id)) return;
        const currentPosition = audioClockPosition();
        if (currentPosition >= clip.startMs + clip.durationMs || clip.startMs > currentPosition + MUSIC_LOOKAHEAD_MS) return;
        const currentMusicDb = calculateGroupedDuckingDb(currentPosition, arrangement.voice, automation, audioSettings);
        const currentBaseGain = graph.sampleAccurateDucking ? 1 : dbToLinear(currentMusicDb);
        const currentGain = currentBaseGain * normalizationGain(asset, audioSettings)
          * clipFadeGain(clip, Math.max(currentPosition, clip.startMs))
          * trackAutomationGain(clip, tabs, Math.max(currentPosition, clip.startMs), arrangement.durationMs);
        const created = createPlayingBuffer(graph, decoded, clip, currentPosition, currentGain, graph.musicInput);
        if (created) registerMusic(clip.id, created);
      });
    });

    const voicePositionMs = nextPositionMs;
    positionRef.current = voicePositionMs;
    const upcomingVoices = clipsInLookahead(arrangement.voice, voicePositionMs, VOICE_LOOKAHEAD_MS);
    const registerVoice = (clipId: string, created: PlayingBuffer) => {
      voicesRef.current.set(clipId, created);
      created.source.onended = () => {
        if (voicesRef.current.get(clipId) === created) {
          voicesRef.current.delete(clipId);
          retiredVoicesRef.current.push(created);
        }
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
        const created = createPlayingBuffer(graph, buffer, clip, voicePositionMs, gainValue, graph.input, true);
        if (created) registerVoice(clip.id, created);
        return;
      }
      void decodeVoiceBuffer(graph, asset).then(decoded => {
        if (!decoded || generation !== playbackGenerationRef.current || voicesRef.current.has(clip.id)) return;
        const currentPosition = audioClockPosition();
        if (currentPosition >= clip.startMs + clip.durationMs || clip.startMs > currentPosition + VOICE_LOOKAHEAD_MS) return;
        const currentGain = dbToLinear(audioSettings.voiceGainDb) * normalizationGain(asset, audioSettings)
          * clipFadeGain(clip, Math.max(currentPosition, clip.startMs))
          * trackAutomationGain(clip, tabs, Math.max(currentPosition, clip.startMs), arrangement.durationMs);
        const created = createPlayingBuffer(graph, decoded, clip, currentPosition, currentGain, graph.input, true);
        if (created) registerVoice(clip.id, created);
      });
    });
  }, [arrangement, assets, audioClockPosition, audioSettings, automation, decodeMusicBuffer, decodeVoiceBuffer, duckingPlan, ensureGraph, tabs]);

  const holdPosition = useCallback(() => {
    const currentPosition = audioClockPosition();
    audioClockRunningRef.current = false;
    positionRef.current = currentPosition;
    basePositionRef.current = currentPosition;
    startedAtRef.current = performance.now();
    setPositionMs(currentPosition);
    playbackGenerationRef.current += 1;
    setIsPreparing(false); setIsPlaying(false); stopElements();
  }, [audioClockPosition, stopElements]);
  const pause = holdPosition;
  const stop = useCallback(() => {
    holdPosition();
    setMusicGainDb(audioSettings.musicGainDb);
    if (graphRef.current?.meter instanceof AudioWorkletNode) graphRef.current.meter.port.postMessage('reset');
    setMeter({ momentary: -120, shortTerm: -120, integrated: -120, peakDbfs: -120 });
  }, [audioSettings.musicGainDb, holdPosition]);
  const reset = useCallback(() => {
    playbackGenerationRef.current += 1;
    audioClockRunningRef.current = false;
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
      await Promise.all([preloadMusic(positionRef.current, graph), preloadVoices(positionRef.current, graph)]);
      if (generation !== playbackGenerationRef.current) return;
      await syncElements(positionRef.current, generation);
      if (generation !== playbackGenerationRef.current) return;
      audioClockPositionRef.current = positionRef.current;
      audioClockTimeRef.current = graph.context.currentTime;
      audioClockRunningRef.current = true;
      basePositionRef.current = positionRef.current; startedAtRef.current = performance.now();
      setIsPreparing(false); setIsPlaying(true);
    })();
  }, [arrangement, assets, ensureGraph, preloadMusic, preloadVoices, stopElements, syncElements]);
  const seek = useCallback((nextPositionMs: number) => {
    if (!arrangement) return;
    playbackGenerationRef.current += 1;
    const generation = playbackGenerationRef.current;
    const clamped = Math.min(arrangement.durationMs, Math.max(0, nextPositionMs));
    audioClockRunningRef.current = false;
    positionRef.current = clamped; basePositionRef.current = clamped; startedAtRef.current = performance.now(); setPositionMs(clamped); stopElements();
    if (isPlaying && clamped < arrangement.durationMs) void (async () => {
      const graph = await ensureGraph();
      await Promise.all([preloadMusic(clamped, graph), preloadVoices(clamped, graph)]);
      if (generation === playbackGenerationRef.current) {
        await syncElements(clamped, generation);
        audioClockPositionRef.current = clamped;
        audioClockTimeRef.current = graph.context.currentTime;
        audioClockRunningRef.current = true;
      }
    })();
  }, [arrangement, ensureGraph, isPlaying, preloadMusic, preloadVoices, stopElements, syncElements]);

  useEffect(() => {
    if (!isPlaying || !arrangement) return;
    const timer = window.setInterval(() => {
      const next = audioClockPosition();
      if (next >= arrangement.durationMs) {
        positionRef.current = arrangement.durationMs; basePositionRef.current = arrangement.durationMs;
        setPositionMs(arrangement.durationMs); stop(); return;
      }
      positionRef.current = next; setPositionMs(next); void syncElements(next, playbackGenerationRef.current);
    }, 40);
    return () => window.clearInterval(timer);
  }, [arrangement, audioClockPosition, isPlaying, stop, syncElements]);
  useEffect(() => {
    if (!arrangement) { reset(); return; }
    pause();
    const clamped = Math.min(positionRef.current, arrangement.durationMs);
    positionRef.current = clamped; basePositionRef.current = clamped; setPositionMs(clamped);
  }, [arrangement]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    stopElements(); musicBuffersRef.current.clear(); voiceBuffersRef.current.clear();
    musicBufferPromisesRef.current.clear(); voiceBufferPromisesRef.current.clear();
    void graphRef.current?.context.close();
  }, [stopElements]);

  return { isPlaying, isPreparing, positionMs, musicGainDb, meter, play, pause, stop, reset, seek };
};
