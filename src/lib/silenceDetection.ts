import type { Arrangement, AudioSettings, ExportSilenceIssue, MediaAsset } from '../types';

interface Interval { startMs: number; endMs: number; name: string }

export const detectTimelineSilences = (arrangement: Arrangement | null, assets: MediaAsset[], audio: AudioSettings,
  thresholdDb: number, minimumMs: number): ExportSilenceIssue[] => {
  if (!arrangement || arrangement.durationMs <= 0) return [];
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  const intervals: Interval[] = [...arrangement.music, ...arrangement.voice]
    .filter(clip => clip.kind !== 'missing' && clip.assetId && clip.durationMs > 0)
    .filter(clip => {
      const analysis = byId.get(clip.assetId!)?.analysis;
      if (!analysis) return true;
      const gain = clip.kind === 'music' ? audio.musicGainDb : audio.voiceGainDb;
      return analysis.samplePeakDb + gain > thresholdDb;
    })
    .map(clip => ({ startMs: Math.max(0, clip.startMs),
      endMs: Math.min(arrangement.durationMs, clip.startMs + clip.durationMs), name: clip.name }))
    .filter(interval => interval.endMs > interval.startMs)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);

  const audible: Interval[] = [];
  intervals.forEach(interval => {
    const previous = audible[audible.length - 1];
    if (previous && interval.startMs <= previous.endMs) {
      if (interval.endMs > previous.endMs) {
        previous.endMs = interval.endMs;
        previous.name = interval.name;
      }
    } else audible.push({ ...interval });
  });

  const issues: ExportSilenceIssue[] = [];
  let cursor = 0;
  let beforeClip: string | undefined;
  audible.forEach(interval => {
    if (interval.startMs - cursor >= minimumMs) issues.push({ startMs: cursor, endMs: interval.startMs,
      durationMs: interval.startMs - cursor, beforeClip, afterClip: interval.name });
    cursor = Math.max(cursor, interval.endMs);
    beforeClip = interval.name;
  });
  if (arrangement.durationMs - cursor >= minimumMs) issues.push({ startMs: cursor, endMs: arrangement.durationMs,
    durationMs: arrangement.durationMs - cursor, beforeClip });
  return issues;
};
