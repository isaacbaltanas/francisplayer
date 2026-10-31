import { describe, expect, it } from 'vitest';
import { createArrangement, durationToIncludeAllMusic, intervalForVoiceDuration, preserveManualVoicePositions, shuffleWithSeed, voiceScheduleDuration } from '../src/lib/arrangement';
import { calculateDuckingDb, dbToGain } from '../src/lib/audio';
import {
  calculateGroupedDuckingDb, createAutomationState, detachAutomationGroup,
  updateAutomationGroup
} from '../src/lib/automation';
import { createAutomationSegments } from '../src/components/AutomationEditor';
import type { ArrangementSettings, MediaAsset } from '../src/types';

const asset = (id: string, kind: 'music' | 'voice', durationMs: number): MediaAsset => ({
  id, kind, durationMs, name: id, sizeBytes: 1, path: id, previewUrl: id, color: '#fff', libraryTabId: `${kind}-1`, waveform: []
});

describe('audio automation', () => {
  const audioSettings = { musicGainDb: -3, voiceGainDb: -1, duckingGainDb: -40, fadeDownMs: 1000, fadeUpMs: 2000 };
  const voiceClip = { id: 'v', kind: 'voice' as const, name: 'voice', startMs: 10_000, generatedStartMs: 10_000, durationMs: 5_000, color: '#fff' };

  it('calculates fade down, hold and recovery in dB', () => {
    expect(calculateDuckingDb(9_000, [voiceClip], audioSettings)).toBe(-3);
    expect(calculateDuckingDb(9_500, [voiceClip], audioSettings)).toBeCloseTo(-21.5);
    expect(calculateDuckingDb(12_000, [voiceClip], audioSettings)).toBe(-40);
    expect(calculateDuckingDb(16_000, [voiceClip], audioSettings)).toBeCloseTo(-21.5);
    expect(calculateDuckingDb(17_000, [voiceClip], audioSettings)).toBe(-3);
  });

  it('converts decibels to a safe linear gain', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(.501, 2);
    expect(dbToGain(6)).toBe(1);
  });
});

describe('automation groups', () => {
  const audioSettings = { musicGainDb: -3, voiceGainDb: -1, duckingGainDb: -40, fadeDownMs: 1000, fadeUpMs: 2000 };
  const arrangement = createArrangement(
    [asset('song', 'music', 100_000)],
    [asset('v1', 'voice', 5_000), asset('v2', 'voice', 5_000)],
    { ...settings, voiceIntervalMs: 30_000 }
  );

  it('links every voice event to the same default style groups', () => {
    const state = createAutomationState(arrangement, audioSettings);
    expect(state.assignments).toHaveLength(2);
    expect(new Set(state.assignments.map(item => item.lowGroupId)).size).toBe(1);
    expect(new Set(state.assignments.map(item => item.fadeDownGroupId)).size).toBe(1);
  });

  it('detaches only one event into a new style group', () => {
    const state = createAutomationState(arrangement, audioSettings);
    const detached = detachAutomationGroup(state, arrangement.voice[0].id, 'low');
    expect(detached.state.assignments[0].lowGroupId).toBe(detached.groupId);
    expect(detached.state.assignments[1].lowGroupId).toBe(state.assignments[1].lowGroupId);
    expect(detached.state.groups).toHaveLength(state.groups.length + 1);
  });

  it('uses a changed group value in playback gain calculation', () => {
    const state = createAutomationState(arrangement, audioSettings);
    const lowGroup = state.assignments[0].lowGroupId;
    const changed = updateAutomationGroup(state, lowGroup, 20);
    const atVoice = arrangement.voice[0].startMs + 1000;
    expect(calculateGroupedDuckingDb(atVoice, arrangement.voice, changed, audioSettings)).toBeCloseTo(-13.98, 1);
  });

  it('never draws a ducking transition backwards when voice clips are close together', () => {
    const closeArrangement = createArrangement(
      [asset('song', 'music', 100_000)],
      [asset('v1', 'voice', 8_000), asset('v2', 'voice', 8_000)],
      { ...settings, voiceIntervalMs: 8_000, allowVoiceOverlap: true }
    );
    const state = createAutomationState(closeArrangement, { ...audioSettings, fadeDownMs: 4_000, fadeUpMs: 6_000 });
    const segments = createAutomationSegments(closeArrangement, state);
    expect(segments.every(segment => segment.startMs <= segment.endMs)).toBe(true);
  });
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
  it('extends the target so Add all never drops the final songs', () => {
    const songs = [asset('one', 'music', 74 * 60_000), asset('perales', 'music', 4 * 60_000), asset('raphael', 'music', 3 * 60_000)];
    const duration = durationToIncludeAllMusic(songs, 74 * 60_000);
    const arrangement = createArrangement(songs, [], { ...settings, targetDurationMs: duration, musicFillMode: 'silence' });
    expect(duration).toBe(81 * 60_000);
    expect(arrangement.music.filter(clip => clip.kind === 'music').map(clip => clip.assetId)).toEqual(['one', 'perales', 'raphael']);
  });

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
    expect(result.music[result.music.length - 1]?.fadeOutMs).toBe(5_000);
    expect(result.warnings).not.toContain('missingMusic');
  });

  it('fills the missing duration with a deterministic random sequence', () => {
    const result = createArrangement([asset('a', 'music', 40_000), asset('b', 'music', 40_000)], [],
      { ...settings, targetDurationMs: 170_000, musicFillMode: 'random' });
    expect(result.music.filter(clip => clip.kind === 'music')).toHaveLength(5);
    expect(result.music[result.music.length - 1]).toMatchObject({ truncated: true, fadeOutMs: 5_000, durationMs: 10_000 });
  });

  it('keeps duration and interval controls mathematically linked', () => {
    const voices = [asset('v1', 'voice', 5_000), asset('v2', 'voice', 5_000), asset('v3', 'voice', 5_000)];
    const duration = voiceScheduleDuration(voices, 30_000, false);
    expect(duration).toBe(95_000);
    expect(intervalForVoiceDuration(voices, duration, false)).toBeCloseTo(30_000, -2);
  });

  it('preserves a manually anchored voice while automatic voices reflow', () => {
    const before = createArrangement([], [asset('v1', 'voice', 5_000), asset('v2', 'voice', 5_000)], settings);
    before.voice[0] = { ...before.voice[0], startMs: 12_345, manuallyPositioned: true };
    const generated = createArrangement([], [asset('v1', 'voice', 5_000), asset('v2', 'voice', 5_000)],
      { ...settings, targetDurationMs: 80_000, voiceIntervalMs: 20_000 });
    const merged = preserveManualVoicePositions(before.voice, generated.voice, generated.durationMs);
    expect(merged.find(clip => clip.assetId === 'v1')).toMatchObject({ startMs: 12_345, manuallyPositioned: true, generatedStartMs: 20_000 });
    expect(merged.find(clip => clip.assetId === 'v2')?.startMs).toBe(40_000);
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
