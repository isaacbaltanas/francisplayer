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

  it('clamps track automation to the first point before its position', () => {
    const payload = {
      assets: [{ id: 'm', path: '/music.wav' }], automation: null,
      libraryTabs: [{ id: 'track', localAutomationEnabled: true,
        automationPoints: [{ position: .2, value: 80 }, { position: .8, value: 20 }] }],
      audioSettings: { musicGainDb: 0, voiceGainDb: 0, duckingGainDb: -20, fadeDownMs: 500, fadeUpMs: 500 },
      arrangement: { durationMs: 10_000, music: [
        { id: 'm1', assetId: 'm', kind: 'music', startMs: 0, durationMs: 10_000, libraryTabId: 'track' }
      ], voice: [] }
    };
    expect(buildExportPlan(payload).filterScript).toContain('if(lt((t+0),2),0.8');
  });

  it('selects codecs and reads FFmpeg progress', () => {
    expect(codecArguments({ format: 'wav', bitDepth: 24 })).toEqual(expect.arrayContaining(['pcm_s24le', '-rf64', 'auto']));
    expect(codecArguments({ format: 'aac', bitrate: 256 })).toContain('256k');
    expect(parseProgress('frame= 1 time=00:00:05.00 speed=1x', 10_000)).toBe(50);
  });

  it('plans very long sessions without reopening repeated source files', () => {
    const music = Array.from({ length: 1000 }, (_, index) => ({ id: `m${index}`, assetId: 'm', kind: 'music',
      name: `Music ${index}`, startMs: index * 36_000, durationMs: 36_000 }));
    const plan = buildExportPlan({ assets: [{ id: 'm', path: '/music.wav' }], libraryTabs: [], automation: null,
      audioSettings: { musicGainDb: -3, voiceGainDb: -1, duckingGainDb: -20, fadeDownMs: 500, fadeUpMs: 500 },
      arrangement: { durationMs: 36_000_000, music, voice: [] } });
    expect(plan.inputs).toEqual(['-i', '/music.wav']);
    expect(plan.filterScript).toContain('asplit=1000');
    expect(plan.filterScript).toContain('apad=whole_dur=36000');
    expect(plan.manifest).toHaveLength(1000);
  });

  it('renders enabled echo and reverb only in the voice chain', () => {
    const payload = {
      assets: [{ id: 'm', path: '/music.wav' }, { id: 'v', path: '/voice.wav' }], libraryTabs: [], automation: null,
      audioSettings: { musicGainDb: -3, voiceGainDb: -1, duckingGainDb: -20, fadeDownMs: 500, fadeUpMs: 500,
        echoEnabled: true, echoDelayMs: 250, echoFeedback: 25, echoMix: 20, reverbEnabled: true, reverbMix: 15 },
      arrangement: { durationMs: 1_000, music: [{ id: 'm1', assetId: 'm', kind: 'music', startMs: 0, durationMs: 1_000 }],
        voice: [{ id: 'v1', assetId: 'v', kind: 'voice', startMs: 0, durationMs: 1_000 }] },
      exportOptions: { normalize: false }
    };
    const script = buildExportPlan(payload).filterScript;
    expect(script.match(/aecho/g)).toHaveLength(1);
    expect(script).toContain('250|500|750');
    const chains = script.split(';\n');
    expect(chains.find(chain => chain.includes('[clip0]'))).not.toContain('aecho');
    expect(chains.find(chain => chain.includes('[clip1]'))).toContain('aecho');
  });

  it('never adds voice effects to a music-only export', () => {
    const plan = buildExportPlan({ assets: [{ id: 'm', path: '/music.wav' }], libraryTabs: [], automation: null,
      audioSettings: { musicGainDb: -3, voiceGainDb: -1, duckingGainDb: -20, fadeDownMs: 500, fadeUpMs: 500,
        echoEnabled: true, reverbEnabled: true },
      arrangement: { durationMs: 1_000, music: [{ id: 'm1', assetId: 'm', kind: 'music', startMs: 0, durationMs: 1_000 }], voice: [] } });
    expect(plan.filterScript).not.toContain('aecho');
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
