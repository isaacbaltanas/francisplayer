import type { AudioAnalysis, AudioSettings, TimelineClip } from '../types';

export const dbToGain = (db: number) => Math.min(1, Math.max(0, 10 ** (db / 20)));
export const dbToLinear = (db: number) => Math.max(0, 10 ** (db / 20));

export const normalizationAdjustmentDb = (analysis: AudioAnalysis, settings: AudioSettings) => {
  const desired = (settings.normalizationTargetLufs ?? -23) - analysis.integratedLufs;
  const peakLimited = (settings.truePeakCeilingDbtp ?? -1) - analysis.truePeakDbtp;
  return Math.max(-30, Math.min(30, desired, peakLimited));
};

export const duckingEnvelope = (clip: TimelineClip, settings: AudioSettings) => {
  const voiceStart = clip.startMs;
  const voiceEnd = clip.startMs + clip.durationMs;
  const fadeDownMs = Math.max(0, settings.fadeDownMs);
  const fadeUpMs = Math.max(0, settings.fadeUpMs);
  const fadeDownOverlapMs = Math.min(clip.durationMs, fadeDownMs, Math.max(0, settings.fadeDownOverlapMs ?? 0));
  const fadeUpOverlapMs = Math.min(
    Math.max(0, clip.durationMs - fadeDownOverlapMs), fadeUpMs, Math.max(0, settings.fadeUpOverlapMs ?? 0)
  );
  const fadeDownEnd = voiceStart + fadeDownOverlapMs;
  const fadeDownStart = fadeDownEnd - fadeDownMs;
  const fadeUpStart = voiceEnd - fadeUpOverlapMs;
  const fadeUpEnd = fadeUpStart + fadeUpMs;
  return { voiceStart, voiceEnd, fadeDownStart, fadeDownEnd, fadeUpStart, fadeUpEnd, fadeDownMs, fadeUpMs,
    fadeDownOverlapMs, fadeUpOverlapMs };
};

export const calculateDuckingDb = (
  positionMs: number,
  voiceClips: TimelineClip[],
  settings: AudioSettings
) => {
  let gainDb = settings.musicGainDb;

  for (const clip of voiceClips) {
    const envelope = duckingEnvelope(clip, settings);
    let candidate = settings.musicGainDb;

    if (positionMs >= envelope.fadeDownEnd && positionMs <= envelope.fadeUpStart) {
      candidate = settings.duckingGainDb;
    } else if (envelope.fadeDownMs > 0 && positionMs >= envelope.fadeDownStart && positionMs < envelope.fadeDownEnd) {
      const progress = (positionMs - envelope.fadeDownStart) / envelope.fadeDownMs;
      candidate = settings.musicGainDb + (settings.duckingGainDb - settings.musicGainDb) * progress;
    } else if (envelope.fadeUpMs > 0 && positionMs > envelope.fadeUpStart && positionMs <= envelope.fadeUpEnd) {
      const progress = (positionMs - envelope.fadeUpStart) / envelope.fadeUpMs;
      candidate = settings.duckingGainDb + (settings.musicGainDb - settings.duckingGainDb) * progress;
    }

    gainDb = Math.min(gainDb, candidate);
  }

  return gainDb;
};
