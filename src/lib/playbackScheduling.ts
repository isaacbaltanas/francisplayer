import type { TimelineClip } from '../types';

export const clipsInLookahead = (clips: TimelineClip[], positionMs: number, lookaheadMs: number) => clips.filter(clip =>
  Boolean(clip.assetId)
  && clip.startMs + clip.durationMs > positionMs
  && clip.startMs <= positionMs + lookaheadMs
);
