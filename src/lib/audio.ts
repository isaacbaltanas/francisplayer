import type { AudioSettings, TimelineClip } from '../types';

export const dbToGain = (db: number) => Math.min(1, Math.max(0, 10 ** (db / 20)));

export const calculateDuckingDb = (
  positionMs: number,
  voiceClips: TimelineClip[],
  settings: AudioSettings
) => {
  let gainDb = settings.musicGainDb;

  for (const clip of voiceClips) {
    const voiceStart = clip.startMs;
    const voiceEnd = clip.startMs + clip.durationMs;
    const fadeDownStart = voiceStart - settings.fadeDownMs;
    const fadeUpEnd = voiceEnd + settings.fadeUpMs;
    let candidate = settings.musicGainDb;

    if (positionMs >= voiceStart && positionMs <= voiceEnd) {
      candidate = settings.duckingGainDb;
    } else if (settings.fadeDownMs > 0 && positionMs >= fadeDownStart && positionMs < voiceStart) {
      const progress = (positionMs - fadeDownStart) / settings.fadeDownMs;
      candidate = settings.musicGainDb + (settings.duckingGainDb - settings.musicGainDb) * progress;
    } else if (settings.fadeUpMs > 0 && positionMs > voiceEnd && positionMs <= fadeUpEnd) {
      const progress = (positionMs - voiceEnd) / settings.fadeUpMs;
      candidate = settings.duckingGainDb + (settings.musicGainDb - settings.duckingGainDb) * progress;
    }

    gainDb = Math.min(gainDb, candidate);
  }

  return gainDb;
};
