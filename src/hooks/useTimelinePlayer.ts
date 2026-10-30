import { useCallback, useEffect, useRef, useState } from 'react';
import { calculateDuckingDb, dbToGain } from '../lib/audio';
import type { Arrangement, AudioSettings, MediaAsset, TimelineClip } from '../types';

interface PlayingElement {
  clipId: string;
  element: HTMLAudioElement;
}

const contains = (clip: TimelineClip, positionMs: number) => (
  positionMs >= clip.startMs && positionMs < clip.startMs + clip.durationMs
);

const createPlayingElement = (asset: MediaAsset, clip: TimelineClip, positionMs: number, volume: number) => {
  const element = new Audio(asset.previewUrl);
  element.preload = 'auto';
  element.volume = volume;
  const start = () => {
    element.currentTime = Math.max(0, (positionMs - clip.startMs) / 1000);
    void element.play().catch(() => undefined);
  };
  if (element.readyState >= HTMLMediaElement.HAVE_METADATA) start();
  else element.addEventListener('loadedmetadata', start, { once: true });
  return element;
};

export const useTimelinePlayer = (
  arrangement: Arrangement | null,
  assets: MediaAsset[],
  audioSettings: AudioSettings
) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [musicGainDb, setMusicGainDb] = useState(audioSettings.musicGainDb);
  const positionRef = useRef(0);
  const basePositionRef = useRef(0);
  const startedAtRef = useRef(0);
  const musicRef = useRef<PlayingElement | null>(null);
  const voicesRef = useRef<Map<string, PlayingElement>>(new Map());

  const stopElements = useCallback(() => {
    musicRef.current?.element.pause();
    musicRef.current = null;
    voicesRef.current.forEach(item => item.element.pause());
    voicesRef.current.clear();
  }, []);

  const syncElements = useCallback((nextPositionMs: number) => {
    if (!arrangement) return;
    const assetMap = new Map(assets.map(asset => [asset.id, asset]));
    const nextMusicGainDb = calculateDuckingDb(nextPositionMs, arrangement.voice, audioSettings);
    const musicVolume = dbToGain(nextMusicGainDb);
    setMusicGainDb(current => Math.abs(current - nextMusicGainDb) > .05 ? nextMusicGainDb : current);

    const musicClip = arrangement.music.find(clip => clip.kind === 'music' && contains(clip, nextPositionMs));
    if (!musicClip || !musicClip.assetId) {
      musicRef.current?.element.pause();
      musicRef.current = null;
    } else if (musicRef.current?.clipId !== musicClip.id) {
      musicRef.current?.element.pause();
      const asset = assetMap.get(musicClip.assetId);
      if (asset) musicRef.current = {
        clipId: musicClip.id,
        element: createPlayingElement(asset, musicClip, nextPositionMs, musicVolume)
      };
    } else {
      musicRef.current.element.volume = musicVolume;
    }

    const activeVoices = arrangement.voice.filter(clip => contains(clip, nextPositionMs));
    const activeIds = new Set(activeVoices.map(clip => clip.id));
    voicesRef.current.forEach((item, clipId) => {
      if (!activeIds.has(clipId)) {
        item.element.pause();
        voicesRef.current.delete(clipId);
      }
    });
    activeVoices.forEach(clip => {
      if (voicesRef.current.has(clip.id) || !clip.assetId) return;
      const asset = assetMap.get(clip.assetId);
      if (asset) voicesRef.current.set(clip.id, {
        clipId: clip.id,
        element: createPlayingElement(asset, clip, nextPositionMs, dbToGain(audioSettings.voiceGainDb))
      });
    });
    voicesRef.current.forEach(item => { item.element.volume = dbToGain(audioSettings.voiceGainDb); });
  }, [arrangement, assets, audioSettings]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    musicRef.current?.element.pause();
    voicesRef.current.forEach(item => item.element.pause());
  }, []);

  const stop = useCallback(() => {
    setIsPlaying(false);
    stopElements();
    positionRef.current = 0;
    basePositionRef.current = 0;
    setPositionMs(0);
    setMusicGainDb(audioSettings.musicGainDb);
  }, [audioSettings.musicGainDb, stopElements]);

  const play = useCallback(() => {
    if (!arrangement) return;
    if (positionRef.current >= arrangement.durationMs) {
      positionRef.current = 0;
      setPositionMs(0);
    }
    stopElements();
    basePositionRef.current = positionRef.current;
    startedAtRef.current = performance.now();
    syncElements(positionRef.current);
    setIsPlaying(true);
  }, [arrangement, stopElements, syncElements]);

  const seek = useCallback((nextPositionMs: number) => {
    if (!arrangement) return;
    const clamped = Math.min(arrangement.durationMs, Math.max(0, nextPositionMs));
    positionRef.current = clamped;
    basePositionRef.current = clamped;
    startedAtRef.current = performance.now();
    setPositionMs(clamped);
    stopElements();
    if (isPlaying && clamped < arrangement.durationMs) syncElements(clamped);
  }, [arrangement, isPlaying, stopElements, syncElements]);

  useEffect(() => {
    if (!isPlaying || !arrangement) return;
    const timer = window.setInterval(() => {
      const nextPosition = basePositionRef.current + performance.now() - startedAtRef.current;
      if (nextPosition >= arrangement.durationMs) {
        stop();
        return;
      }
      positionRef.current = nextPosition;
      setPositionMs(nextPosition);
      syncElements(nextPosition);
    }, 40);
    return () => window.clearInterval(timer);
  }, [arrangement, isPlaying, stop, syncElements]);

  useEffect(() => {
    stop();
  }, [arrangement]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stopElements(), [stopElements]);

  return { isPlaying, positionMs, musicGainDb, play, pause, stop, seek };
};
