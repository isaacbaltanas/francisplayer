import { describe, expect, it } from 'vitest';
import { buildExportPlan, codecArguments, parseProgress } from '../electron/exportAudio';

describe('local audio export', () => {
  it('builds a mix with fades, delay and every playable clip', () => {
    const payload = {
      assets: [{ id: 'm', path: '/music.wav' }, { id: 'v', path: '/voice.wav' }],
      libraryTabs: [], automation: null,
      audioSettings: { musicGainDb: -3, voiceGainDb: -1, duckingGainDb: -20, fadeDownMs: 500, fadeUpMs: 500 },
      arrangement: { durationMs: 10_000, music: [{ id: 'm1', assetId: 'm', kind: 'music', startMs: 0, durationMs: 10_000, fadeInMs: 1000 }],
        voice: [{ id: 'v1', assetId: 'v', kind: 'voice', startMs: 3_000, durationMs: 2_000, fadeOutMs: 500 }] }
    };
    const plan = buildExportPlan(payload);
    expect(plan.inputs).toEqual(['-i', '/music.wav', '-i', '/voice.wav']);
    expect(plan.filterScript).toContain('afade=t=in');
    expect(plan.filterScript).toContain('afade=t=out');
    expect(plan.filterScript).toContain('amix=inputs=2');
  });

  it('selects codecs and reads FFmpeg progress', () => {
    expect(codecArguments({ format: 'wav', bitDepth: 24 })).toContain('pcm_s24le');
    expect(codecArguments({ format: 'aac', bitrate: 256 })).toContain('256k');
    expect(parseProgress('frame= 1 time=00:00:05.00 speed=1x', 10_000)).toBe(50);
  });
});
