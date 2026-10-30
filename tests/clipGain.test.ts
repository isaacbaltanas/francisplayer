import { describe, expect, it } from 'vitest';
import { automationValueAt, clipFadeGain } from '../src/lib/clipGain';
import type { TimelineClip } from '../src/types';

const clip: TimelineClip = {
  id: 'c', kind: 'voice', name: 'voice', startMs: 1_000, generatedStartMs: 1_000,
  durationMs: 10_000, color: '#fff', fadeInMs: 2_000, fadeOutMs: 1_000
};

describe('clip and track gain', () => {
  it('applies fade-in and fade-out envelopes', () => {
    expect(clipFadeGain(clip, 1_500)).toBeCloseTo(.25);
    expect(clipFadeGain(clip, 6_000)).toBe(1);
    expect(clipFadeGain(clip, 10_500)).toBeCloseTo(.5);
  });

  it('interpolates conventional automation points', () => {
    const points = [{ id: 'a', position: 0, value: 100 }, { id: 'b', position: .5, value: 20 }, { id: 'c', position: 1, value: 60 }];
    expect(automationValueAt(points, .25)).toBe(60);
    expect(automationValueAt(points, .75)).toBe(40);
  });
});
