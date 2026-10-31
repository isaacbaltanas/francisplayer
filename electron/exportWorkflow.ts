import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { buildExportPlan, codecArguments, parseProgress } from './exportAudio.js';
import { parseLoudnessReport } from './importAudio.js';

type Progress = { phase: string; percent: number; detail?: string };
type ProcessSetter = (process: ChildProcess | null) => void;

const fixed = (value: number) => Number(value.toFixed(3));

const run = (binary: string, args: string[], setProcess: ProcessSetter,
  onStderr?: (chunk: string) => void) => new Promise<string>((resolve, reject) => {
  const child = spawn(binary, args, { windowsHide: true });
  setProcess(child);
  let stderr = '';
  child.stderr.on('data', chunk => {
    const text = chunk.toString();
    stderr += text;
    if (stderr.length > 8 * 1024 * 1024) stderr = stderr.slice(-8 * 1024 * 1024);
    onStderr?.(text);
  });
  child.once('error', error => { setProcess(null); reject(error); });
  child.once('exit', (code, signal) => {
    setProcess(null);
    if (code === 0) resolve(stderr);
    else reject(new Error(signal ? `Export cancelled (${signal})` : (stderr.trim().slice(-4000) || `FFmpeg exited with code ${code}`)));
  });
});

const sha256File = (filePath: string) => new Promise<string>((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  stream.on('data', chunk => hash.update(chunk));
  stream.once('error', reject);
  stream.once('end', () => resolve(hash.digest('hex')));
});

const decodedPcmHash = (binary: string, filePath: string, channels: number, sampleRate: number,
  setProcess: ProcessSetter, audioFilter?: string) => new Promise<string>((resolve, reject) => {
  const args = ['-hide_banner', '-loglevel', 'error', '-err_detect', 'explode', '-i', filePath, '-map', '0:a:0'];
  if (audioFilter) args.push('-af', audioFilter);
  args.push('-ac', String(channels), '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1');
  const child = spawn(binary, args, { windowsHide: true });
  setProcess(child);
  const hash = crypto.createHash('sha256');
  let stderr = '';
  child.stdout.on('data', chunk => hash.update(chunk));
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.once('error', error => { setProcess(null); reject(error); });
  child.once('exit', (code, signal) => {
    setProcess(null);
    if (code === 0) resolve(hash.digest('hex'));
    else reject(new Error(signal ? `Verification cancelled (${signal})` : (stderr.trim() || `Decode exited with code ${code}`)));
  });
});

const parseOutTime = (output: string) => {
  const values = [...output.matchAll(/out_time_(?:us|ms)=(\d+)/g)].map(match => Number(match[1]) / 1000);
  return values.length ? Math.max(...values) : 0;
};

export const parseSilenceReport = (output: string, durationMs: number) => {
  const events = [...output.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)]
    .map(match => ({ type: match[1], timeMs: Math.max(0, Number(match[2]) * 1000) }));
  const issues: Array<{ startMs: number; endMs: number; durationMs: number }> = [];
  let start: number | null = null;
  events.forEach(event => {
    if (event.type === 'start') start = event.timeMs;
    else if (start !== null) {
      issues.push({ startMs: Math.round(start), endMs: Math.round(event.timeMs), durationMs: Math.round(event.timeMs - start) });
      start = null;
    }
  });
  if (start !== null) issues.push({ startMs: Math.round(start), endMs: Math.round(durationMs), durationMs: Math.round(durationMs - start) });
  return issues.filter(issue => issue.durationMs > 0);
};

const loudnormAnalysis = async (binary: string, masterPath: string, setProcess: ProcessSetter) => {
  const output = await run(binary, ['-hide_banner', '-nostats', '-i', masterPath, '-af',
    'loudnorm=I=-14:LRA=11:TP=-1.5:print_format=json', '-f', 'null', '-'], setProcess);
  const json = /\{[\s\S]*?"target_offset"\s*:\s*"[^}]+\}/.exec(output)?.[0];
  if (!json) throw new Error('Could not measure the master for two-pass loudness normalization');
  const measured = JSON.parse(json);
  return `loudnorm=I=-14:LRA=11:TP=-1.5:measured_I=${measured.input_i}:measured_LRA=${measured.input_lra}:measured_TP=${measured.input_tp}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true:print_format=summary`;
};

const clipNeighbors = (payload: any, startMs: number, endMs: number) => {
  const clips = [...payload.arrangement.music, ...payload.arrangement.voice]
    .filter((clip: any) => clip.kind !== 'missing').sort((a: any, b: any) => a.startMs - b.startMs);
  const containingStart = clips.find((clip: any) => clip.startMs <= startMs && clip.startMs + clip.durationMs >= startMs);
  const containingEnd = clips.find((clip: any) => clip.startMs <= endMs && clip.startMs + clip.durationMs >= endMs);
  const before = containingStart ?? [...clips].reverse().find((clip: any) => clip.startMs + clip.durationMs <= startMs);
  const after = containingEnd ?? clips.find((clip: any) => clip.startMs >= endMs);
  return { beforeClip: before?.name, afterClip: after?.name };
};

const assertSources = async (payload: any, manifest: any[], notify: (progress: Progress) => void) => {
  const assets = new Map(payload.assets.map((asset: any) => [asset.id, asset]));
  const unique = [...new Map(manifest.map(item => [item.assetId, assets.get(item.assetId)])).values()] as any[];
  for (let index = 0; index < unique.length; index += 1) {
    const asset = unique[index];
    if (!asset?.path || !fs.existsSync(asset.path)) throw new Error(`Missing source file: ${asset?.name ?? asset?.id ?? 'unknown'}`);
    const stat = fs.statSync(asset.path);
    if (!stat.isFile() || stat.size <= 0) throw new Error(`Invalid source file: ${asset.path}`);
    if (asset.fingerprint) {
      const current = await sha256File(asset.path);
      if (current !== asset.fingerprint) throw new Error(`Source file changed after import: ${asset.name}`);
    }
    notify({ phase: 'preflight', percent: 2 + (index + 1) / Math.max(1, unique.length) * 8,
      detail: `${index + 1} / ${unique.length}` });
  }
};

const ensureSpace = (directory: string, durationMs: number, sampleRate: number, channels: number) => {
  if (!('statfsSync' in fs)) return;
  const stat = fs.statfsSync(directory);
  const available = Number(stat.bavail) * Number(stat.bsize);
  const masterBytes = durationMs / 1000 * sampleRate * channels * 4;
  if (available < masterBytes * 1.25 + 256 * 1024 * 1024) {
    throw new Error(`Not enough free disk space. The verified master needs approximately ${Math.ceil(masterBytes / 1024 ** 3)} GB.`);
  }
};

const analyzeRenderedFile = async (binary: string, filePath: string, options: any, expectedDurationMs: number,
  setProcess: ProcessSetter) => {
  const decodeOutput = await run(binary, ['-hide_banner', '-loglevel', 'error', '-xerror', '-err_detect', 'explode',
    '-i', filePath, '-map', '0:a:0', '-f', 'null', '-', '-progress', 'pipe:2', '-nostats'], setProcess);
  const durationMs = Math.round(parseOutTime(decodeOutput));
  const analysisFilters = [];
  if (options.detectSilence) analysisFilters.push(`silencedetect=noise=${options.silenceThresholdDb}dB:d=${Math.max(.05, options.silenceMinimumMs / 1000)}`);
  analysisFilters.push('ebur128=peak=true:framelog=verbose', 'astats=metadata=0:reset=0');
  const analysisOutput = await run(binary, ['-hide_banner', '-nostats', '-i', filePath, '-map', '0:a:0',
    '-af', analysisFilters.join(','), '-f', 'null', '-'], setProcess);
  const loudness = parseLoudnessReport(analysisOutput);
  const sampleMatches = [...analysisOutput.matchAll(/Number of samples:\s*(\d+)/g)];
  const sampleCount = Number(sampleMatches[sampleMatches.length - 1]?.[1] ?? 0);
  const exactDurationMs = sampleCount > 0 ? sampleCount / options.sampleRate * 1000 : durationMs;
  const stream = /Audio:\s*[^,]+,\s*(\d+)\s*Hz,\s*([^,\r\n]+)/.exec(analysisOutput);
  const actualSampleRate = Number(stream?.[1] ?? options.sampleRate);
  const actualChannels = /^mono\b/i.test(stream?.[2] ?? '') ? 1 : /^stereo\b/i.test(stream?.[2] ?? '') ? 2 : options.channels;
  const silenceIssues = options.detectSilence ? parseSilenceReport(analysisOutput, exactDurationMs || expectedDurationMs) : [];
  const nan = Number(/Number of NaNs:\s*(\d+)/.exec(analysisOutput)?.[1] ?? 0);
  const infinity = Number(/Number of Infs:\s*(\d+)/.exec(analysisOutput)?.[1] ?? 0);
  return { durationMs: Math.round(exactDurationMs), loudness, silenceIssues, nan, infinity, sampleCount, actualSampleRate, actualChannels };
};

const parseDb = (value: string | undefined) => {
  if (!value) return undefined;
  if (/^-?inf$/i.test(value)) return -Infinity;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const compareWithMaster = async (binary: string, masterPath: string, encodedPath: string, options: any,
  normalizationFilter: string | undefined, setProcess: ProcessSetter) => {
  const layout = options.channels === 1 ? 'mono' : 'stereo';
  const masterFilters = `${normalizationFilter ? `${normalizationFilter},` : ''}aformat=sample_rates=${options.sampleRate}:channel_layouts=${layout}`;
  const outputFilters = `aformat=sample_rates=${options.sampleRate}:channel_layouts=${layout}`;
  const difference = options.channels === 1 ? 'pan=mono|c0=c0-c1' : 'pan=stereo|c0=c0-c2|c1=c1-c3';
  const filter = `[0:a]${masterFilters}[master];[1:a]${outputFilters}[encoded];[master][encoded]amerge=inputs=2,${difference},astats=metadata=0:reset=0`;
  const output = await run(binary, ['-hide_banner', '-nostats', '-i', masterPath, '-i', encodedPath,
    '-filter_complex', filter, '-f', 'null', '-'], setProcess);
  const rmsValues = [...output.matchAll(/RMS level dB:\s*(-?inf|-?[\d.]+)/gi)];
  const peakValues = [...output.matchAll(/Peak level dB:\s*(-?inf|-?[\d.]+)/gi)];
  const rmsDb = parseDb(rmsValues[rmsValues.length - 1]?.[1]);
  const peakDb = parseDb(peakValues[peakValues.length - 1]?.[1]);
  if (rmsDb === undefined || peakDb === undefined) throw new Error('Could not compare the encoded audio with its verified master');
  const lossless = options.format === 'wav' || options.format === 'flac';
  const limitDb = lossless ? (options.bitDepth === 16 ? -90 : options.bitDepth === 24 ? -125 : -140) : -18;
  return { rmsDb, peakDb, limitDb, passed: rmsDb <= limitDb };
};

const replaceVerifiedFile = (partialPath: string, outputPath: string) => {
  try { fs.renameSync(partialPath, outputPath); }
  catch (error: any) {
    if (!fs.existsSync(outputPath)) throw error;
    fs.unlinkSync(outputPath);
    fs.renameSync(partialPath, outputPath);
  }
};

export const runVerifiedExport = async ({ binary, payload, options, outputPath, notify, setProcess }: {
  binary: string; payload: any; options: any; outputPath: string;
  notify: (progress: Progress) => void; setProcess: ProcessSetter;
}) => {
  const plan = buildExportPlan({ ...payload, exportOptions: options });
  const expectedDurationMs = payload.arrangement.durationMs;
  notify({ phase: 'preflight', percent: 1 });
  await assertSources(payload, plan.manifest, notify);
  ensureSpace(path.dirname(outputPath), expectedDurationMs, options.sampleRate, options.channels);

  const temporaryDirectory = fs.mkdtempSync(path.join(path.dirname(outputPath), '.francis-render-'));
  const extension = path.extname(outputPath);
  const partialPath = path.join(path.dirname(outputPath), `.${path.basename(outputPath, extension)}.francis-partial-${process.pid}${extension}`);
  const masterPath = path.join(temporaryDirectory, 'verified-master.w64');
  const filterPath = path.join(temporaryDirectory, 'mix.ffmpeg');
  fs.writeFileSync(filterPath, plan.filterScript);
  try {
    notify({ phase: 'rendering', percent: 10, detail: 'PCM 32-bit float' });
    let renderOutput = '';
    await run(binary, [...plan.inputs, '-filter_complex_script', filterPath, '-map', '[out]', '-ac', String(options.channels),
      '-ar', String(options.sampleRate), '-c:a', 'pcm_f32le', '-f', 'w64', '-y', masterPath, '-progress', 'pipe:2', '-nostats'], setProcess, chunk => {
      renderOutput += chunk;
      const progress = parseProgress(renderOutput, expectedDurationMs);
      if (progress !== null) notify({ phase: 'rendering', percent: 10 + progress * .45 });
      renderOutput = renderOutput.slice(-2000);
    });

    const normalizationFilter = options.normalize ? await loudnormAnalysis(binary, masterPath, setProcess) : undefined;
    notify({ phase: 'encoding', percent: 56 });
    let encodeOutput = '';
    const encodeArgs = ['-hide_banner', '-i', masterPath, '-map', '0:a:0'];
    if (normalizationFilter) encodeArgs.push('-af', normalizationFilter);
    encodeArgs.push('-ac', String(options.channels), '-ar', String(options.sampleRate), ...codecArguments(options),
      '-map_metadata', '-1', '-y', partialPath, '-progress', 'pipe:2', '-nostats');
    await run(binary, encodeArgs, setProcess, chunk => {
      encodeOutput += chunk;
      const progress = parseProgress(encodeOutput, expectedDurationMs);
      if (progress !== null) notify({ phase: 'encoding', percent: 56 + progress * .19 });
      encodeOutput = encodeOutput.slice(-2000);
    });

    notify({ phase: 'verifying', percent: 76, detail: 'Full decode' });
    const analysis = options.verifyOutput
      ? await analyzeRenderedFile(binary, partialPath, options, expectedDurationMs, setProcess)
      : { durationMs: expectedDurationMs, loudness: undefined, silenceIssues: [], nan: 0, infinity: 0,
        sampleCount: Math.round(expectedDurationMs / 1000 * options.sampleRate), actualSampleRate: options.sampleRate, actualChannels: options.channels };
    notify({ phase: 'verifying', percent: 86, detail: 'SHA-256' });
    const fileSha256 = await sha256File(partialPath);
    const decodedPcmSha256 = await decodedPcmHash(binary, partialPath, options.channels, options.sampleRate, setProcess);
    const masterPcmSha256 = await decodedPcmHash(binary, masterPath, options.channels, options.sampleRate, setProcess, normalizationFilter);
    const comparison = options.verifyOutput
      ? await compareWithMaster(binary, masterPath, partialPath, options, normalizationFilter, setProcess)
      : { rmsDb: -Infinity, peakDb: -Infinity, limitDb: -18, passed: true };
    const losslessDuration = options.format === 'wav' || options.format === 'flac';
    const durationTolerance = (losslessDuration ? 1 : options.format === 'mp3' ? 1152 : 1024) / options.sampleRate * 1000 + .01;
    const durationMatches = Math.abs(analysis.durationMs - expectedDurationMs) <= durationTolerance;
    const streamMatches = analysis.actualSampleRate === options.sampleRate && analysis.actualChannels === options.channels;
    if (options.verifyOutput && (!durationMatches || !streamMatches || analysis.nan > 0 || analysis.infinity > 0 || !comparison.passed)) {
      throw new Error(!durationMatches ? `Verified duration differs from the timeline (${analysis.durationMs} ms / ${expectedDurationMs} ms)`
        : !streamMatches ? `Encoded stream differs from the requested format (${analysis.actualSampleRate} Hz / ${analysis.actualChannels} channels)`
        : !comparison.passed ? `The encoded audio differs excessively from its master (${fixed(comparison.rmsDb)} dB RMS)`
          : 'The rendered audio contains invalid numeric samples');
    }
    const enrichedSilences = analysis.silenceIssues.map(issue => ({ ...issue, ...clipNeighbors(payload, issue.startMs, issue.endMs) }));
    const checks = [
      { id: 'sources', status: 'passed', label: 'Source integrity', detail: `${new Set(plan.manifest.map((item: any) => item.assetId)).size} source files matched their fingerprints`,
        detailKey: 'exportCheckDetail_sources', detailParams: { count: new Set(plan.manifest.map((item: any) => item.assetId)).size } },
      { id: 'clips', status: 'passed', label: 'Timeline coverage', detail: `${plan.manifest.length} of ${plan.manifest.length} clips included in the render plan`,
        detailKey: 'exportCheckDetail_clips', detailParams: { count: plan.manifest.length } },
      { id: 'decode', status: 'passed', label: 'Complete decode', detail: 'The resulting file was decoded from start to finish without errors',
        detailKey: 'exportCheckDetail_decode' },
      { id: 'duration', status: durationMatches ? 'passed' : 'failed', label: 'Sample duration', detail: `${analysis.durationMs} ms / ${expectedDurationMs} ms expected`,
        detailKey: 'exportCheckDetail_duration', detailParams: { actual: analysis.durationMs, expected: expectedDurationMs } },
      { id: 'stream', status: streamMatches ? 'passed' : 'failed', label: 'Stream format', detail: `${analysis.actualSampleRate} Hz · ${analysis.actualChannels} channel(s) · ${analysis.sampleCount} samples`,
        detailKey: 'exportCheckDetail_stream', detailParams: { rate: analysis.actualSampleRate, channels: analysis.actualChannels, samples: analysis.sampleCount } },
      { id: 'numeric', status: analysis.nan === 0 && analysis.infinity === 0 ? 'passed' : 'failed', label: 'Valid samples', detail: `${analysis.nan} NaN · ${analysis.infinity} infinite samples`,
        detailKey: 'exportCheckDetail_numeric', detailParams: { nan: analysis.nan, infinity: analysis.infinity } },
      { id: 'coherence', status: comparison.passed ? 'passed' : 'failed', label: 'Master coherence',
        detail: `Difference ${Number.isFinite(comparison.rmsDb) ? `${fixed(comparison.rmsDb)} dB RMS` : 'digitally silent'} · limit ${comparison.limitDb} dB`,
        detailKey: 'exportCheckDetail_coherence', detailParams: { difference: Number.isFinite(comparison.rmsDb) ? fixed(comparison.rmsDb) : '−∞', limit: comparison.limitDb } },
      { id: 'silence', status: enrichedSilences.length ? 'warning' : 'passed', label: 'Extended silence',
        detail: enrichedSilences.length ? `${enrichedSilences.length} region(s) require review` : 'No suspicious silence detected',
        detailKey: enrichedSilences.length ? 'exportCheckDetail_silenceWarning' : 'exportCheckDetail_silencePassed', detailParams: { count: enrichedSilences.length } },
      { id: 'hash', status: 'passed', label: 'Cryptographic fingerprint', detail: `SHA-256 ${fileSha256}`,
        detailKey: 'exportCheckDetail_hash', detailParams: { hash: fileSha256 } }
    ];
    const report: any = {
      verified: checks.every(check => check.status !== 'failed'), createdAt: new Date().toISOString(), outputPath,
      durationMs: analysis.durationMs, expectedDurationMs, format: options.format, channels: options.channels,
      sampleRate: options.sampleRate, clipCount: plan.manifest.length,
      musicClipCount: plan.manifest.filter((item: any) => item.kind === 'music').length,
      voiceClipCount: plan.manifest.filter((item: any) => item.kind === 'voice').length,
      automationCount: (payload.automation?.groups?.length ?? 0) + payload.libraryTabs.reduce((sum: number, tab: any) => sum + (tab.automationPoints?.length ?? 0), 0),
      fileSha256, decodedPcmSha256, masterPcmSha256,
      integratedLufs: analysis.loudness?.integratedLufs, loudnessRangeLu: analysis.loudness?.loudnessRangeLu,
      truePeakDbtp: analysis.loudness?.truePeakDbtp, samplePeakDb: analysis.loudness?.samplePeakDb,
      rmsDb: analysis.loudness?.rmsDb, differenceRmsDb: comparison.rmsDb, differencePeakDb: comparison.peakDb,
      silenceIssues: enrichedSilences, checks
    };
    notify({ phase: 'publishing', percent: 98 });
    replaceVerifiedFile(partialPath, outputPath);
    const reportPath = `${outputPath}.francis-report.json`;
    const reportPartialPath = `${reportPath}.partial`;
    fs.writeFileSync(reportPartialPath, JSON.stringify(report, null, 2));
    replaceVerifiedFile(reportPartialPath, reportPath);
    notify({ phase: 'complete', percent: 100 });
    return { outputPath, reportPath, report };
  } finally {
    setProcess(null);
    try { if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath); } catch { /* Best effort cleanup. */ }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};
