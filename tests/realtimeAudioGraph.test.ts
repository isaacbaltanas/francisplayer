import { describe, expect, it } from 'vitest';
import { configureRealtimeAudioGraph, smoothAudioGain, startAudioGain, type RealtimeAudioGraph } from '../src/lib/realtimeAudioGraph';

const graph = () => ({
  dry: { gain: { value: 0 } },
  echoTaps: Array.from({ length: 8 }, () => ({ delay: { delayTime: { value: 0 } }, gain: { gain: { value: 0 } } })),
  reverbTaps: Array.from({ length: 12 }, () => ({ delay: { delayTime: { value: 0 } }, gain: { gain: { value: 0 } } }))
}) as unknown as RealtimeAudioGraph;

describe('realtime audio effects graph', () => {
  it('ramps running gain changes instead of assigning discontinuous values', () => {
    const calls: Array<[string, number, number]> = [];
    const parameter = {
      value: .7,
      cancelScheduledValues: (time: number) => calls.push(['cancel', time, time]),
      setTargetAtTime: (value: number, time: number, constant: number) => calls.push(['target', value, time + constant])
    } as unknown as AudioParam;
    smoothAudioGain(parameter, .2, { currentTime: 10 }, .006);
    expect(calls).toEqual([['cancel', 10, 10], ['target', .2, 10.006]]);
  });

  it('uses a short technical fade when a new audio source starts', () => {
    const calls: Array<[string, number, number]> = [];
    const parameter = {
      value: 1,
      cancelScheduledValues: (time: number) => calls.push(['cancel', time, time]),
      setValueAtTime: (value: number, time: number) => calls.push(['set', value, time]),
      linearRampToValueAtTime: (value: number, time: number) => calls.push(['linear', value, time])
    } as unknown as AudioParam;
    startAudioGain(parameter, .8, { currentTime: 2 }, .008);
    expect(calls).toEqual([['cancel', 2, 2], ['set', 0, 2], ['linear', .8, 2.008]]);
  });
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
