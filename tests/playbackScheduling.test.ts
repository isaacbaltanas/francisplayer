import { describe, expect, it } from 'vitest';
import { clipsInLookahead } from '../src/lib/playbackScheduling';
import type { TimelineClip } from '../src/types';

const clip = (id: string, startMs: number, durationMs = 1_000, assetId: string | null = id): TimelineClip => ({
  id, assetId: assetId ?? undefined, kind: 'voice', name: id, startMs, generatedStartMs: startMs, durationMs, color: '#fff'
});

describe('voice playback scheduling', () => {
  it('selects active and upcoming voices without opening distant clips', () => {
    const result = clipsInLookahead([
      clip('finished', 0), clip('active', 1_500, 2_000), clip('next', 8_000), clip('distant', 20_000)
    ], 2_000, 10_000);
    expect(result.map(item => item.id)).toEqual(['active', 'next']);
  });

  it('ignores timeline placeholders without a source asset', () => {
    expect(clipsInLookahead([clip('missing', 1_000, 1_000, null)], 0, 10_000)).toEqual([]);
  });
});
