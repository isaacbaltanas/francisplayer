import type { TimelineClip } from '../types';

export const clipsInLookahead = (clips: TimelineClip[], positionMs: number, lookaheadMs: number) => clips.filter(clip =>
  Boolean(clip.assetId)
  && clip.startMs + clip.durationMs > positionMs
  && clip.startMs <= positionMs + lookaheadMs
);

export const technicalFadeWindow = (startTime: number, durationSeconds: number, maximumFadeSeconds = .008) => {
  const fadeSeconds = Math.min(maximumFadeSeconds, Math.max(0, durationSeconds) / 2);
  const endTime = startTime + Math.max(0, durationSeconds);
  return {
    startTime,
    fadeInEndTime: startTime + fadeSeconds,
    fadeOutStartTime: Math.max(startTime + fadeSeconds, endTime - fadeSeconds),
    endTime,
    fadeSeconds
  };
};
