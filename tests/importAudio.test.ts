import { describe, expect, it } from 'vitest';
import { inferCollectionName, parseLoudnessReport, parseSilenceBounds, waveformFromPcm } from '../electron/importAudio';

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

  it('detects only leading and trailing silence and keeps safety padding', () => {
    const report = '[silencedetect] silence_start: 0\n[silencedetect] silence_end: 0.62\n'
      + '[silencedetect] silence_start: 4.8\n[silencedetect] silence_end: 5';
    expect(parseSilenceBounds(report, 5_000, 80)).toEqual({ trimStartMs: 540, trimEndMs: 4_880, trimmed: true });
  });

  it('does not trim an entirely silent or implausibly short result', () => {
    const report = '[silencedetect] silence_start: 0\n[silencedetect] silence_end: 5';
    expect(parseSilenceBounds(report, 5_000, 0)).toEqual({ trimStartMs: 0, trimEndMs: 5_000, trimmed: false });
  });
});
