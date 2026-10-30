import type { Arrangement, SnapMode, TimelineClip } from '../types';

export interface SnapResult {
  startMs: number;
  guideMs: number | null;
  reason: 'grid' | 'edge' | 'original' | null;
}

const nearest = (value: number, targets: number[], toleranceMs: number) => {
  let best: number | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const nextDistance = Math.abs(value - target);
    if (nextDistance < distance && nextDistance <= toleranceMs) {
      best = target;
      distance = nextDistance;
    }
  }
  return best;
};

export const snapClipStart = ({
  proposedStartMs,
  clip,
  arrangement,
  mode,
  gridMs,
  toleranceMs
}: {
  proposedStartMs: number;
  clip: TimelineClip;
  arrangement: Arrangement;
  mode: SnapMode;
  gridMs: number;
  toleranceMs: number;
}): SnapResult => {
  const maxStart = Math.max(0, arrangement.durationMs - clip.durationMs);
  const proposed = Math.max(0, Math.min(maxStart, proposedStartMs));
  const allClips = [...arrangement.music, ...arrangement.voice].filter(item => item.id !== clip.id && item.kind !== 'missing');
  const candidates: Array<{ value: number; guide: number; reason: SnapResult['reason'] }> = [];

  if (mode === 'smart' || mode === 'original') {
    candidates.push({ value: clip.generatedStartMs, guide: clip.generatedStartMs, reason: 'original' });
  }
  if (mode === 'smart' || mode === 'grid') {
    const grid = Math.round(proposed / gridMs) * gridMs;
    candidates.push({ value: grid, guide: grid, reason: 'grid' });
  }
  if (mode === 'smart' || mode === 'edges') {
    for (const other of allClips) {
      const otherEnd = other.startMs + other.durationMs;
      candidates.push({ value: other.startMs, guide: other.startMs, reason: 'edge' });
      candidates.push({ value: otherEnd, guide: otherEnd, reason: 'edge' });
      candidates.push({ value: other.startMs - clip.durationMs, guide: other.startMs, reason: 'edge' });
      candidates.push({ value: otherEnd - clip.durationMs, guide: otherEnd, reason: 'edge' });
    }
  }

  const target = nearest(proposed, candidates.map(item => item.value), toleranceMs);
  if (target === null) return { startMs: proposed, guideMs: null, reason: null };
  const candidate = candidates.find(item => item.value === target)!;
  return { startMs: Math.max(0, Math.min(maxStart, target)), guideMs: candidate.guide, reason: candidate.reason };
};
