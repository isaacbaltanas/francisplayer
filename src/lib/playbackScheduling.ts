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

export const voicePlaybackWindow = (
  startTime: number,
  logicalDurationSeconds: number,
  availablePostRollSeconds: number,
  maximumPostRollSeconds = .05
) => {
  const logicalDuration = Math.max(0, logicalDurationSeconds);
  const postRollSeconds = Math.min(maximumPostRollSeconds, Math.max(0, availablePostRollSeconds));
  const sourceDurationSeconds = logicalDuration + postRollSeconds;
  const startFade = Math.min(.008, sourceDurationSeconds / 2);
  const endTime = startTime + sourceDurationSeconds;
  const fadeOutStartTime = postRollSeconds > 0
    ? startTime + logicalDuration
    : Math.max(startTime + startFade, endTime - Math.min(.008, sourceDurationSeconds / 2));
  return {
    startTime,
    fadeInEndTime: startTime + startFade,
    fadeOutStartTime,
    endTime,
    postRollSeconds,
    sourceDurationSeconds
  };
};
