import { describe, expect, it } from 'vitest';
import { inferCollectionName, parseLoudnessReport, waveformFromPcm } from '../electron/importAudio';

describe('mass import naming', () => {
  it('reduces decoded PCM to normalized waveform peaks', () => {
    const pcm = Buffer.alloc(8 * 4);
    [0, .25, -.5, 1.4, .1, -.2, .75, 0].forEach((sample, index) => pcm.writeFloatLE(sample, index * 4));
    expect(waveformFromPcm(pcm, 4)).toEqual([.25, 1, .2, .75]);
  });

  it('uses the most common speaker name and removes production words', () => {
    expect(inferCollectionName([
      '01_Juan_Garcia_cuña_coche_final.wav',
      '02_Juan_Garcia_cuña_seguro_master.wav',
      '03_Juan_Garcia_promocion.wav'
    ], '/Audio/Locuciones')).toBe('Juan Garcia');
  });

  it('falls back to the folder when names have no useful common token', () => {
    expect(inferCollectionName(['coche.wav', 'seguro.wav'], '/Audio/Locutor Ana')).toBe('Locutor Ana');
  });

  it('parses EBU R128 values and limits normalization by true peak', () => {
    const report = `Summary:\n I: -20.0 LUFS\n LRA: 4.2 LU\n True peak:\n Peak: -2.0 dBFS\n Overall\n Peak level dB: -2.4\n RMS level dB: -23.1`;
    expect(parseLoudnessReport(report, -14, -1)).toMatchObject({
      integratedLufs: -20, loudnessRangeLu: 4.2, truePeakDbtp: -2, recommendedGainDb: 1
    });
  });
});
