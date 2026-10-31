import { describe, expect, it } from 'vitest';
import { automationValueAt, clipFadeGain } from '../src/lib/clipGain';
import { calculateDuckingDb, normalizationAdjustmentDb } from '../src/lib/audio';
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

  it('normalizes loudness without exceeding the true-peak ceiling', () => {
    const analysis = { integratedLufs: -20, loudnessRangeLu: 2, truePeakDbtp: -2, samplePeakDb: -2.2, rmsDb: -23,
      recommendedGainDb: 0, analyzedAt: '2026-10-31T00:00:00Z' };
    expect(normalizationAdjustmentDb(analysis, { musicGainDb: 0, voiceGainDb: 0, duckingGainDb: -20, fadeDownMs: 0, fadeUpMs: 0,
      normalizationTargetLufs: -14, truePeakCeilingDbtp: -1 })).toBe(1);
  });

  it('keeps the ducking envelope continuous at voice boundaries', () => {
    const voice = { ...clip, startMs: 5_000, durationMs: 8_000 };
    const settings = { musicGainDb: -3, voiceGainDb: -1, duckingGainDb: -40,
      fadeDownMs: 1_500, fadeUpMs: 2_000, fadeDownOverlapMs: 0, fadeUpOverlapMs: 0 };
    expect(Math.abs(calculateDuckingDb(4_999, [voice], settings) - calculateDuckingDb(5_000, [voice], settings))).toBeLessThan(.03);
    expect(Math.abs(calculateDuckingDb(12_999, [voice], settings) - calculateDuckingDb(13_000, [voice], settings))).toBeLessThan(.03);
  });
});
