import type { TimelineClip } from '../types';

export const clipsOverlap = (first: TimelineClip, second: TimelineClip) => (
  first.startMs < second.startMs + second.durationMs && second.startMs < first.startMs + first.durationMs
);

export const overlappingClipIds = (clips: TimelineClip[]): Set<string> => {
  const result = new Set<string>();
  for (let first = 0; first < clips.length; first += 1) {
    for (let second = first + 1; second < clips.length; second += 1) {
      if (clipsOverlap(clips[first], clips[second])) {
        result.add(clips[first].id);
        result.add(clips[second].id);
      }
    }
  }
  return result;
};
