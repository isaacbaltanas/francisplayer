import { describe, expect, it } from 'vitest';
import { snapClipStart } from '../src/lib/snapping';
import type { Arrangement, TimelineClip } from '../src/types';

const clip = (id: string, startMs: number, durationMs = 1_000): TimelineClip => ({
  id, assetId: id, name: id, kind: 'voice', startMs, generatedStartMs: startMs,
  durationMs, color: '#fff'
});

const arrangement: Arrangement = {
  durationMs: 20_000,
  music: [clip('music', 4_000, 2_000)],
  voice: [clip('moving', 10_000), clip('other', 8_000, 1_000)],
  warnings: []
};

describe('magnetic snapping', () => {
  it('returns to the generated position in original mode', () => {
    const result = snapClipStart({ proposedStartMs: 10_120, clip: arrangement.voice[0], arrangement,
      mode: 'original', gridMs: 1_000, toleranceMs: 200 });
    expect(result).toMatchObject({ startMs: 10_000, guideMs: 10_000, reason: 'original' });
  });

  it('snaps to a neighbouring clip edge', () => {
    const result = snapClipStart({ proposedStartMs: 9_080, clip: arrangement.voice[0], arrangement,
      mode: 'edges', gridMs: 1_000, toleranceMs: 100 });
    expect(result.startMs).toBe(9_000);
    expect(result.reason).toBe('edge');
  });

  it('snaps to the grid and clamps the timeline bounds', () => {
    const grid = snapClipStart({ proposedStartMs: 5_430, clip: arrangement.voice[0], arrangement,
      mode: 'grid', gridMs: 500, toleranceMs: 100 });
    expect(grid.startMs).toBe(5_500);

    const end = snapClipStart({ proposedStartMs: 30_000, clip: arrangement.voice[0], arrangement,
      mode: 'smart', gridMs: 1_000, toleranceMs: 100 });
    expect(end.startMs).toBe(19_000);
  });
});
