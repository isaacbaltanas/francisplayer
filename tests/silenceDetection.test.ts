import { describe, expect, it } from 'vitest';
import { detectTimelineSilences } from '../src/lib/silenceDetection';
import type { Arrangement, AudioSettings, MediaAsset } from '../src/types';

const audio = { musicGainDb: -3, voiceGainDb: -1 } as AudioSettings;
const asset = (id: string, samplePeakDb = -1): MediaAsset => ({
  id, kind: 'music', name: id, durationMs: 10_000, sizeBytes: 1, path: `/${id}.wav`, previewUrl: '',
  color: '#fff', libraryTabId: 'music-1', waveform: [],
  analysis: { integratedLufs: -14, loudnessRangeLu: 1, truePeakDbtp: samplePeakDb, samplePeakDb,
    rmsDb: -18, recommendedGainDb: 0, analyzedAt: '' }
});

describe('timeline silence detection', () => {
  it('reports uncovered timeline regions at or above the configured duration', () => {
    const arrangement: Arrangement = { durationMs: 30_000, warnings: [], voice: [], music: [
      { id: 'one', assetId: 'one', kind: 'music', name: 'One', startMs: 0, generatedStartMs: 0, durationMs: 10_000, color: '#fff' },
      { id: 'two', assetId: 'two', kind: 'music', name: 'Two', startMs: 15_000, generatedStartMs: 15_000, durationMs: 10_000, color: '#fff' }
    ] };
    expect(detectTimelineSilences(arrangement, [asset('one'), asset('two')], audio, -50, 3_000)).toEqual([
      expect.objectContaining({ startMs: 10_000, endMs: 15_000, durationMs: 5_000 }),
      expect.objectContaining({ startMs: 25_000, endMs: 30_000, durationMs: 5_000 })
    ]);
  });

  it('treats a whole clip below the configured peak threshold as inaudible', () => {
    const arrangement: Arrangement = { durationMs: 10_000, warnings: [], voice: [], music: [
      { id: 'quiet', assetId: 'quiet', kind: 'music', name: 'Quiet', startMs: 0, generatedStartMs: 0, durationMs: 10_000, color: '#fff' }
    ] };
    expect(detectTimelineSilences(arrangement, [asset('quiet', -60)], audio, -50, 3_000)[0]).toMatchObject({
      startMs: 0, endMs: 10_000, durationMs: 10_000
    });
  });
});
