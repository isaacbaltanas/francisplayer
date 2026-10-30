import { describe, expect, it } from 'vitest';
import { overlappingClipIds } from '../src/lib/overlaps';
import type { TimelineClip } from '../src/types';

const clip = (id: string, startMs: number, durationMs: number): TimelineClip => ({
  id, kind: 'voice', name: id, startMs, generatedStartMs: startMs, durationMs, color: '#fff'
});

describe('voice overlap detection', () => {
  it('marks every clip involved in a real overlap but not touching edges', () => {
    const ids = overlappingClipIds([clip('a', 0, 1_000), clip('b', 900, 500), clip('c', 1_400, 200)]);
    expect([...ids]).toEqual(['a', 'b']);
  });
});
