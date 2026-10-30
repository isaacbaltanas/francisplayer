import { describe, expect, it } from 'vitest';
import { createArrangement, shuffleWithSeed } from '../src/lib/arrangement';
import type { ArrangementSettings, MediaAsset } from '../src/types';

const asset = (id: string, kind: 'music' | 'voice', durationMs: number): MediaAsset => ({
  id, kind, durationMs, name: id, sizeBytes: 1, path: id, previewUrl: id, color: '#fff'
});

const settings: ArrangementSettings = {
  targetDurationMs: 100_000,
  musicOrder: 'sequential',
  voiceOrder: 'sequential',
  repeatMusic: false,
  voicePlacement: 'interval',
  voiceIntervalMs: 30_000,
  allowVoiceOverlap: false,
  seed: 42
};

describe('arrangement engine', () => {
  it('creates an explicit missing region when music is insufficient', () => {
    const result = createArrangement([asset('song', 'music', 60_000)], [], settings);
    expect(result.music).toHaveLength(2);
    expect(result.music[1]).toMatchObject({ kind: 'missing', startMs: 60_000, durationMs: 40_000 });
    expect(result.warnings).toContain('missingMusic');
  });

  it('repeats and trims music exactly to the target duration', () => {
    const result = createArrangement([asset('song', 'music', 40_000)], [], { ...settings, repeatMusic: true });
    expect(result.music.map(clip => clip.durationMs)).toEqual([40_000, 40_000, 20_000]);
    expect(result.music[result.music.length - 1]?.truncated).toBe(true);
    expect(result.warnings).not.toContain('missingMusic');
  });

  it('pushes voices apart when overlap is disabled', () => {
    const voices = [asset('v1', 'voice', 25_000), asset('v2', 'voice', 25_000)];
    const result = createArrangement([], voices, { ...settings, voiceIntervalMs: 10_000 });
    expect(result.voice.map(clip => clip.startMs)).toEqual([10_000, 35_000]);
  });

  it('uses a repeatable seeded shuffle', () => {
    const values = ['a', 'b', 'c', 'd', 'e'];
    expect(shuffleWithSeed(values, 2026)).toEqual(shuffleWithSeed(values, 2026));
    expect(shuffleWithSeed(values, 2026)).not.toEqual(shuffleWithSeed(values, 2027));
  });
});
