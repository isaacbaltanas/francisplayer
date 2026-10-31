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

  it('exports a non-destructive trimmed source range', () => {
    const payload = {
      assets: [{ id: 'v', path: '/voice.wav' }], libraryTabs: [], automation: null,
      audioSettings: { musicGainDb: 0, voiceGainDb: 0, duckingGainDb: -20, fadeDownMs: 500, fadeUpMs: 500 },
      arrangement: { durationMs: 5_000, music: [], voice: [
        { id: 'v1', assetId: 'v', kind: 'voice', startMs: 1_000, durationMs: 2_500, sourceOffsetMs: 620 }
      ] }
    };
    expect(buildExportPlan(payload).filterScript).toContain('atrim=start=0.62:end=3.12');
  });

  it('selects codecs and reads FFmpeg progress', () => {
    expect(codecArguments({ format: 'wav', bitDepth: 24 })).toContain('pcm_s24le');
    expect(codecArguments({ format: 'aac', bitrate: 256 })).toContain('256k');
    expect(parseProgress('frame= 1 time=00:00:05.00 speed=1x', 10_000)).toBe(50);
  });

  it('renders enabled echo and reverb in the master chain', () => {
    const payload = {
      assets: [{ id: 'm', path: '/music.wav' }], libraryTabs: [], automation: null,
      audioSettings: { musicGainDb: -3, voiceGainDb: -1, duckingGainDb: -20, fadeDownMs: 500, fadeUpMs: 500,
        echoEnabled: true, echoDelayMs: 250, echoFeedback: 25, echoMix: 20, reverbEnabled: true, reverbMix: 15 },
      arrangement: { durationMs: 1_000, music: [{ id: 'm1', assetId: 'm', kind: 'music', startMs: 0, durationMs: 1_000 }], voice: [] },
      exportOptions: { normalize: false }
    };
    expect(buildExportPlan(payload).filterScript.match(/aecho/g)).toHaveLength(2);
  });

  it('exports ducking fades that overlap the voice boundaries', () => {
    const payload = {
      assets: [{ id: 'm', path: '/music.wav' }, { id: 'v', path: '/voice.wav' }], libraryTabs: [], automation: null,
      audioSettings: { musicGainDb: 0, voiceGainDb: 0, duckingGainDb: -20, fadeDownMs: 1_000, fadeUpMs: 2_000,
        fadeDownOverlapMs: 500, fadeUpOverlapMs: 1_000 },
      arrangement: { durationMs: 10_000, music: [{ id: 'm1', assetId: 'm', kind: 'music', startMs: 0, durationMs: 10_000 }],
        voice: [{ id: 'v1', assetId: 'v', kind: 'voice', startMs: 3_000, durationMs: 4_000 }] }
    };
    const script = buildExportPlan(payload).filterScript;
    expect(script).toContain('between((t+0),2.5,3.5)');
    expect(script).toContain('between((t+0),6,8)');
  });
});
