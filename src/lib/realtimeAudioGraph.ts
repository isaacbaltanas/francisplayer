import type { AudioSettings, LoudnessMeterReading } from '../types';

export interface RealtimeAudioGraph {
  context: AudioContext;
  input: GainNode;
  output: GainNode;
  dry: GainNode;
  echoTaps: Array<{ delay: DelayNode; gain: GainNode }>;
  reverbTaps: Array<{ delay: DelayNode; gain: GainNode }>;
  meter: AudioWorkletNode | GainNode;
  meterSink: GainNode;
}

export const smoothAudioGain = (
  parameter: AudioParam,
  target: number,
  context: Pick<BaseAudioContext, 'currentTime'>,
  rampSeconds = .045
) => {
  const now = context.currentTime;
  const safeTarget = Math.max(0, Math.min(8, target));
  const current = Math.max(0, parameter.value);
  if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(now);
  else {
    parameter.cancelScheduledValues(now);
    parameter.setValueAtTime(current, now);
  }
  const end = now + Math.max(.001, rampSeconds);
  if (safeTarget > .000001 && current > .000001) parameter.exponentialRampToValueAtTime(safeTarget, end);
  else parameter.linearRampToValueAtTime(safeTarget, end);
};

export const startAudioGain = (
  parameter: AudioParam,
  target: number,
  context: Pick<BaseAudioContext, 'currentTime'>,
  rampSeconds = .008
) => {
  const now = context.currentTime;
  parameter.cancelScheduledValues(now);
  parameter.setValueAtTime(0, now);
  parameter.linearRampToValueAtTime(Math.max(0, Math.min(8, target)), now + Math.max(.001, rampSeconds));
};

export const configureRealtimeAudioGraph = (graph: RealtimeAudioGraph, settings: AudioSettings) => {
  graph.dry.gain.value = 1;
  const delay = Math.max(1, settings.echoDelayMs ?? 260) / 1000;
  const feedback = Math.max(0, Math.min(.9, (settings.echoFeedback ?? 30) / 100));
  const echoMix = settings.echoEnabled ? Math.max(0, Math.min(1, (settings.echoMix ?? 15) / 100)) : 0;
  graph.echoTaps.forEach((tap, index) => {
    tap.delay.delayTime.value = delay * (index + 1);
    tap.gain.gain.value = echoMix * feedback ** index;
  });
  const reverbMix = settings.reverbEnabled ? Math.max(0, Math.min(1, (settings.reverbMix ?? 15) / 100)) : 0;
  const reverbDuration = Math.max(.1, Math.min(10, settings.reverbDuration ?? 1.8));
  const reverbDecay = Math.max(.1, settings.reverbDecay ?? 2.4);
  const ratios = [0.025, 0.037, 0.053, 0.079, 0.113, 0.167, 0.239, 0.337, 0.463, 0.617, 0.79, 1];
  graph.reverbTaps.forEach((tap, index) => {
    tap.delay.delayTime.value = reverbDuration * ratios[index];
    tap.gain.gain.value = reverbMix * .35 * Math.exp(-reverbDecay * ratios[index]);
  });
};

export const createRealtimeAudioGraph = async (
  onMeter: (reading: LoudnessMeterReading) => void = () => undefined
): Promise<RealtimeAudioGraph> => {
  const context = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' });
  const input = context.createGain();
  const output = context.createGain();
  const dry = context.createGain();
  const echoTaps = Array.from({ length: 8 }, () => ({ delay: context.createDelay(30), gain: context.createGain() }));
  const reverbTaps = Array.from({ length: 12 }, () => ({ delay: context.createDelay(12), gain: context.createGain() }));
  const meterSink = context.createGain();
  meterSink.gain.value = 0;
  let meter: AudioWorkletNode | GainNode;
  try {
    await context.audioWorklet.addModule('./loudness-worklet.js');
    meter = new AudioWorkletNode(context, 'francis-loudness', { channelCount: 2, channelCountMode: 'max', outputChannelCount: [2] });
    meter.port.onmessage = event => onMeter(event.data as LoudnessMeterReading);
  } catch { meter = context.createGain(); }
  input.connect(dry).connect(output);
  echoTaps.forEach(tap => input.connect(tap.delay).connect(tap.gain).connect(output));
  reverbTaps.forEach(tap => input.connect(tap.delay).connect(tap.gain).connect(output));
  output.connect(context.destination);
  output.connect(meter).connect(meterSink).connect(context.destination);
  return { context, input, output, dry, echoTaps, reverbTaps, meter, meterSink };
};
