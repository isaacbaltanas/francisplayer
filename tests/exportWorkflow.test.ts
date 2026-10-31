import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ffmpegStatic from 'ffmpeg-static';
import { parseSilenceReport, runVerifiedExport } from '../electron/exportWorkflow';

describe('verified export workflow', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'francis-export-test-'));
  const musicPath = path.join(directory, 'music.wav');
  const voicePath = path.join(directory, 'voice.wav');
  const outputPath = path.join(directory, 'programme.wav');

  beforeAll(() => {
    if (!ffmpegStatic) throw new Error('FFmpeg unavailable');
    execFileSync(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-ac', '2', '-ar', '48000', musicPath]);
    execFileSync(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1',
      '-ac', '1', '-ar', '48000', voicePath]);
  });
  afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
  const payload = () => {
    const fingerprint = (filePath: string) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    return {
      assets: [
        { id: 'music', name: 'Music', path: musicPath, fingerprint: fingerprint(musicPath) },
        { id: 'voice', name: 'Voice', path: voicePath, fingerprint: fingerprint(voicePath) }
      ],
      libraryTabs: [], automation: null,
      audioSettings: { musicGainDb: -3, voiceGainDb: -1, duckingGainDb: -20, fadeDownMs: 200, fadeUpMs: 200,
        echoEnabled: false, echoDelayMs: 260, echoFeedback: 30, echoMix: 15,
        reverbEnabled: false, reverbDuration: 1.8, reverbDecay: 2.4, reverbMix: 15 },
      arrangement: { durationMs: 3000,
        music: [{ id: 'm1', assetId: 'music', kind: 'music', name: 'Music', startMs: 0, durationMs: 3000 }],
        voice: [{ id: 'v1', assetId: 'voice', kind: 'voice', name: 'Voice', startMs: 1000, durationMs: 1000 }] }
    };
  };

  it('parses complete and terminal silence regions', () => {
    expect(parseSilenceReport('silence_start: 1\nsilence_end: 3\nsilence_start: 8', 10_000)).toEqual([
      { startMs: 1000, endMs: 3000, durationMs: 2000 },
      { startMs: 8000, endMs: 10000, durationMs: 2000 }
    ]);
  });

  it('renders, fully decodes, hashes and atomically publishes an audio file', async () => {
    if (!ffmpegStatic) throw new Error('FFmpeg unavailable');
    const result = await runVerifiedExport({ binary: ffmpegStatic, payload: payload(),
      options: { format: 'wav', channels: 2, sampleRate: 48000, bitDepth: 24, bitrate: 256,
        compressionLevel: 5, normalize: false, verifyOutput: true, detectSilence: false,
        silenceThresholdDb: -50, silenceMinimumMs: 3000 }, outputPath,
      notify: () => undefined, setProcess: () => undefined });
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.existsSync(result.reportPath)).toBe(true);
    expect(result.report.verified).toBe(true);
    expect(result.report.clipCount).toBe(2);
    expect(result.report.durationMs).toBeGreaterThanOrEqual(2990);
    expect(result.report.fileSha256).toMatch(/^[a-f0-9]{64}$/);
  }, 30_000);

  it('uses measured two-pass normalization before encoding a lossy deliverable', async () => {
    if (!ffmpegStatic) throw new Error('FFmpeg unavailable');
    const mp3Path = path.join(directory, 'normalised.mp3');
    const result = await runVerifiedExport({ binary: ffmpegStatic, payload: payload(),
      options: { format: 'mp3', channels: 2, sampleRate: 48000, bitDepth: 24, bitrate: 256,
        compressionLevel: 5, normalize: true, verifyOutput: true, detectSilence: true,
        silenceThresholdDb: -60, silenceMinimumMs: 500 }, outputPath: mp3Path,
      notify: () => undefined, setProcess: () => undefined });
    expect(result.report.verified).toBe(true);
    expect(result.report.integratedLufs).toBeTypeOf('number');
    expect(result.report.differenceRmsDb).toBeLessThanOrEqual(-18);
  }, 30_000);

  it('renders the shared deterministic echo and reverb network', async () => {
    if (!ffmpegStatic) throw new Error('FFmpeg unavailable');
    const effectsPayload = payload();
    effectsPayload.audioSettings = { ...effectsPayload.audioSettings,
      echoEnabled: true, echoDelayMs: 180, echoFeedback: 35, echoMix: 12,
      reverbEnabled: true, reverbDuration: 1.2, reverbDecay: 2.2, reverbMix: 10 };
    const effectsPath = path.join(directory, 'effects.flac');
    const result = await runVerifiedExport({ binary: ffmpegStatic, payload: effectsPayload,
      options: { format: 'flac', channels: 2, sampleRate: 48000, bitDepth: 24, bitrate: 256,
        compressionLevel: 5, normalize: false, verifyOutput: true, detectSilence: false,
        silenceThresholdDb: -50, silenceMinimumMs: 3000 }, outputPath: effectsPath,
      notify: () => undefined, setProcess: () => undefined });
    expect(result.report.verified).toBe(true);
    expect(result.report.differenceRmsDb).toBeLessThanOrEqual(-125);
  }, 30_000);
});
