import { describe, expect, it } from 'vitest';
import { configureRealtimeAudioGraph, type RealtimeAudioGraph } from '../src/lib/realtimeAudioGraph';

const graph = () => ({
  dry: { gain: { value: 0 } },
  echoTaps: Array.from({ length: 8 }, () => ({ delay: { delayTime: { value: 0 } }, gain: { gain: { value: 0 } } })),
  reverbTaps: Array.from({ length: 12 }, () => ({ delay: { delayTime: { value: 0 } }, gain: { gain: { value: 0 } } }))
}) as unknown as RealtimeAudioGraph;

describe('realtime audio effects graph', () => {
  it('uses the configured echo timing, feedback, and wet mix', () => {
    const target = graph();
    configureRealtimeAudioGraph(target, {
      musicGainDb: -3, voiceGainDb: -1, duckingGainDb: -40, fadeDownMs: 1_500, fadeUpMs: 2_000,
      echoEnabled: true, echoDelayMs: 200, echoFeedback: 50, echoMix: 20
    });
    expect(target.echoTaps[0].delay.delayTime.value).toBe(.2);
    expect(target.echoTaps[1].delay.delayTime.value).toBe(.4);
    expect(target.echoTaps[0].gain.gain.value).toBe(.2);
    expect(target.echoTaps[1].gain.gain.value).toBe(.1);
  });

  it('removes wet paths when effects are disabled', () => {
    const target = graph();
    configureRealtimeAudioGraph(target, {
      musicGainDb: -3, voiceGainDb: -1, duckingGainDb: -40, fadeDownMs: 1_500, fadeUpMs: 2_000,
      echoEnabled: false, echoMix: 90, reverbEnabled: false, reverbMix: 90
    });
    expect(target.dry.gain.value).toBe(1);
    expect(target.echoTaps.every(tap => tap.gain.gain.value === 0)).toBe(true);
    expect(target.reverbTaps.every(tap => tap.gain.gain.value === 0)).toBe(true);
  });
});
