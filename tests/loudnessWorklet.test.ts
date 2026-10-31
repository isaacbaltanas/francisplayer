import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('realtime loudness worklet', () => {
  it('meters a continuous signal with bounded preallocated history', () => {
    let Processor: any;
    const readings: any[] = [];
    class WorkletBase {
      port = { onmessage: (_event: any) => undefined, postMessage: (value: any) => readings.push(value) };
    }
    const sandbox: any = {
      AudioWorkletProcessor: WorkletBase,
      sampleRate: 48_000,
      registerProcessor: (_name: string, value: any) => { Processor = value; }
    };
    vm.runInNewContext(fs.readFileSync('public/loudness-worklet.js', 'utf8'), sandbox);
    const processor = new Processor();
    for (let block = 0; block < 40; block += 1) {
      const left = new Float32Array(128).fill(.1);
      const right = new Float32Array(128).fill(.1);
      expect(processor.process([[left, right]], [[new Float32Array(128), new Float32Array(128)]])).toBe(true);
    }
    expect(readings.length).toBeGreaterThan(0);
    expect(Number.isFinite(readings[readings.length - 1].momentary)).toBe(true);
    expect(Number.isFinite(readings[readings.length - 1].integrated)).toBe(true);
    expect(processor.blocks).toBeUndefined();
    expect(processor.histogramCounts.length).toBe(901);
  });
});
