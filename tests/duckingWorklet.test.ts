import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('sample-accurate ducking worklet', () => {
  it('recovers continuously after a voice without touching the UI clock', () => {
    let Processor: any;
    class WorkletBase { port = { onmessage: (_event: any) => undefined }; }
    const sandbox: any = {
      AudioWorkletProcessor: WorkletBase,
      sampleRate: 48_000,
      currentTime: 2,
      registerProcessor: (_name: string, value: any) => { Processor = value; }
    };
    vm.runInNewContext(fs.readFileSync('public/ducking-worklet.js', 'utf8'), sandbox);
    const processor = new Processor();
    processor.port.onmessage({ data: { type: 'configure', anchorContextTime: 0, anchorPositionMs: 0, defaultHighDb: 0,
      envelopes: [{ startMs: 1_000, endMs: 2_000, downStartMs: 900, downEndMs: 1_000,
        upStartMs: 2_000, upEndMs: 2_100, highDb: 0, lowDb: -40 }] } });
    const input = new Float32Array(128).fill(1);
    const output = new Float32Array(128);
    expect(processor.process([[input]], [[output]])).toBe(true);
    expect(output[0]).toBeCloseTo(.01, 5);
    expect(output[127]).toBeGreaterThan(output[0]);
    for (let index = 1; index < output.length; index += 1) {
      expect(output[index]).toBeGreaterThanOrEqual(output[index - 1]);
      expect(Math.abs(output[index] - output[index - 1])).toBeLessThan(.0001);
    }
  });
});
