import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { mediaUrlForPath } from './mediaUrl.js';

const audioExtensions = new Set(['.mp3', '.wav', '.wave', '.m4a', '.aac', '.flac', '.ogg', '.oga', '.opus', '.aif', '.aiff', '.wma']);
const disposableTokens = new Set(['final', 'master', 'mix', 'mezcla', 'version', 'versión', 'audio', 'spot', 'cuña', 'promo', 'take', 'toma', 'wav', 'mp3']);

export const inferCollectionName = (fileNames: string[], fallback: string) => {
  const tokenSets = fileNames.map(name => path.basename(name, path.extname(name)).toLowerCase()
    .replace(/\b\d{1,8}\b/g, ' ').split(/[^\p{L}\p{N}]+/u)
    .filter(token => token.length > 1 && !disposableTokens.has(token)));
  const counts = new Map<string, number>();
  tokenSets.forEach(tokens => [...new Set(tokens)].forEach(token => counts.set(token, (counts.get(token) ?? 0) + 1)));
  const threshold = Math.max(2, Math.ceil(fileNames.length * .45));
  const common = [...counts.entries()].filter(([, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([token]) => token);
  const selected = tokenSets[0]?.filter(token => common.includes(token)).slice(0, 3) ?? [];
  const value = selected.length ? selected.join(' ') : path.basename(fallback);
  return value.replace(/(^|\s)\p{L}/gu, match => match.toUpperCase()) || 'Lista importada';
};

export const enumerateFiles = (inputPaths: string[]) => {
  const files: string[] = [];
  const visit = (target: string) => {
    let stat: fs.Stats;
    try { stat = fs.statSync(target); } catch { files.push(target); return; }
    if (stat.isDirectory()) {
      let children: string[];
      try { children = fs.readdirSync(target).sort((a, b) => a.localeCompare(b)); }
      catch { files.push(target); return; }
      children.forEach(child => visit(path.join(target, child)));
    } else files.push(target);
  };
  inputPaths.forEach(visit);
  return files;
};

const fingerprint = (filePath: string) => new Promise<string>((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  stream.on('data', chunk => hash.update(chunk));
  stream.on('error', reject);
  stream.on('end', () => resolve(hash.digest('hex')));
});

export const parseLoudnessReport = (output: string, targetLufs = -23, truePeakCeiling = -1) => {
  const summary = output.slice(output.lastIndexOf('Summary:'));
  const integrated = /I:\s*(-?[\d.]+)\s+LUFS/.exec(summary);
  const range = /LRA:\s*(-?[\d.]+)\s+LU/.exec(summary);
  const truePeak = /True peak:[\s\S]*?Peak:\s*(-?[\d.]+)\s+dB/.exec(summary);
  const peaks = [...output.matchAll(/Peak level dB:\s*(-?[\d.]+)/g)];
  const rmsValues = [...output.matchAll(/RMS level dB:\s*(-?[\d.]+)/g)];
  if (!integrated || !truePeak) return undefined;
  const integratedLufs = Number(integrated[1]);
  const truePeakDbtp = Number(truePeak[1]);
  const desired = targetLufs - integratedLufs;
  const recommendedGainDb = Math.max(-30, Math.min(30, desired, truePeakCeiling - truePeakDbtp));
  return {
    integratedLufs, loudnessRangeLu: Number(range?.[1] ?? 0), truePeakDbtp,
    samplePeakDb: Number(peaks[peaks.length - 1]?.[1] ?? truePeakDbtp), rmsDb: Number(rmsValues[rmsValues.length - 1]?.[1] ?? integratedLufs),
    recommendedGainDb, analyzedAt: new Date().toISOString()
  };
};

const inspectAudio = (binary: string, filePath: string, verifyIntegrity: boolean, analyzeLoudness: boolean,
  targetLufs: number, truePeakCeiling: number) => new Promise<{ durationMs: number; valid: boolean; detail: string; analysis?: any }>((resolve) => {
  const args = ['-hide_banner', '-i', filePath, '-map', '0:a:0'];
  if (analyzeLoudness) args.push('-af', 'ebur128=peak=true,astats=metadata=0:reset=0');
  if (!verifyIntegrity && !analyzeLoudness) args.push('-t', '0.05');
  args.push('-f', 'null', '-');
  const process = spawn(binary, args, { windowsHide: true });
  let output = '';
  process.stderr.on('data', chunk => { output += chunk.toString(); });
  process.once('error', error => resolve({ durationMs: 0, valid: false, detail: error.message }));
  process.once('exit', code => {
    const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(output);
    const durationMs = match ? Math.round((+match[1] * 3600 + +match[2] * 60 + +match[3]) * 1000) : 0;
    const errorLine = output.split(/\r?\n/).find(line => /invalid|error|corrupt|could not|failed/i.test(line))?.trim() ?? '';
    resolve({ durationMs, valid: code === 0 && durationMs > 0, detail: errorLine || (code === 0 ? 'OK' : `FFmpeg exit ${code}`),
      analysis: analyzeLoudness ? parseLoudnessReport(output, targetLufs, truePeakCeiling) : undefined });
  });
});

export const waveformFromPcm = (pcm: Buffer, bins = 256) => {
  const sampleCount = Math.floor(pcm.length / 4);
  if (!sampleCount) return [];
  const binSize = Math.max(1, Math.ceil(sampleCount / bins));
  return Array.from({ length: bins }, (_, bin) => {
    let peak = 0;
    const end = Math.min(sampleCount, (bin + 1) * binSize);
    for (let sample = bin * binSize; sample < end; sample += 1) {
      const value = Math.abs(pcm.readFloatLE(sample * 4));
      if (Number.isFinite(value)) peak = Math.max(peak, value);
    }
    return Math.round(Math.max(.025, Math.min(1, peak)) * 1000) / 1000;
  });
};

export const extractWaveform = (binary: string, filePath: string) => new Promise<number[]>(resolve => {
  const process = spawn(binary, ['-hide_banner', '-loglevel', 'error', '-i', filePath, '-map', '0:a:0',
    '-ac', '1', '-ar', '1000', '-f', 'f32le', 'pipe:1'], { windowsHide: true });
  const chunks: Buffer[] = [];
  process.stdout.on('data', chunk => chunks.push(Buffer.from(chunk)));
  process.once('error', () => resolve([]));
  process.once('exit', code => resolve(code === 0 ? waveformFromPcm(Buffer.concat(chunks)) : []));
});

const parallelMap = async <T, R>(items: T[], concurrency: number, work: (item: T, index: number) => Promise<R>) => {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) { const index = cursor++; results[index] = await work(items[index], index); }
  });
  await Promise.all(workers);
  return results;
};

export const generateWaveforms = async (binary: string, filePaths: string[], onProgress?: (completed: number, total: number) => void) => {
  const uniquePaths = [...new Set(filePaths)];
  let completed = 0;
  return parallelMap(uniquePaths, 4, async filePath => {
    const waveform = await extractWaveform(binary, filePath);
    completed += 1;
    onProgress?.(completed, uniquePaths.length);
    return { path: filePath, waveform };
  });
};

export const scanImportPaths = async ({ inputPaths, kind, tabId, verifyIntegrity, analyzeLoudness, normalizationTargetLufs = -23,
  truePeakCeilingDbtp = -1, knownFingerprints, knownFiles, ffmpegPath, onProgress }: any) => {
  const startedAt = new Date().toISOString();
  const folderImport = inputPaths.some((target: string) => { try { return fs.statSync(target).isDirectory(); } catch { return false; } });
  const files = enumerateFiles(inputPaths);
  const known = new Set<string>(knownFingerprints || []);
  const knownFallback = new Set((knownFiles || []).map((item: any) => `${path.resolve(item.path)}:${item.sizeBytes}`));
  let completed = 0;
  const results = await parallelMap(files, 4, async (filePath, index) => {
    const finish = (result: any) => { completed += 1; onProgress?.(completed, files.length); return result; };
    const name = path.basename(filePath);
    let stat: fs.Stats;
    try { stat = await fs.promises.stat(filePath); }
    catch (error: any) { return finish({ outcome: 'quarantined', item: quarantine(kind, filePath, 0, '', 'unreadable', error.message), log: { path: filePath, name, outcome: 'quarantined', detail: error.message } }); }
    let hash = '';
    try { hash = await fingerprint(filePath); }
    catch (error: any) { return finish({ outcome: 'quarantined', item: quarantine(kind, filePath, stat.size, '', 'unreadable', error.message), log: { path: filePath, name, outcome: 'quarantined', detail: error.message } }); }
    if (known.has(hash) || knownFallback.has(`${path.resolve(filePath)}:${stat.size}`)) {
      return finish({ outcome: 'duplicate', log: { path: filePath, name, outcome: 'duplicate', detail: 'Exact file already present' } });
    }
    known.add(hash);
    if (!audioExtensions.has(path.extname(filePath).toLowerCase())) {
      return finish({ outcome: 'quarantined', item: quarantine(kind, filePath, stat.size, hash, 'unsupported', 'Unsupported file extension'),
        log: { path: filePath, name, outcome: 'quarantined', detail: 'Unsupported file extension' } });
    }
    const inspected = await inspectAudio(ffmpegPath, filePath, verifyIntegrity, analyzeLoudness, normalizationTargetLufs, truePeakCeilingDbtp);
    if (!inspected.valid) {
      const reason = inspected.durationMs <= 0 ? 'invalidDuration' : 'corrupt';
      return finish({ outcome: 'quarantined', item: { ...quarantine(kind, filePath, stat.size, hash, reason, inspected.detail), durationMs: inspected.durationMs },
        log: { path: filePath, name, outcome: 'quarantined', detail: inspected.detail } });
    }
    const waveform = await extractWaveform(ffmpegPath, filePath);
    return finish({ outcome: 'imported', asset: {
      id: `${kind}-${Date.now()}-${index}-${crypto.randomUUID()}`, kind, name: path.basename(filePath, path.extname(filePath)),
      durationMs: inspected.durationMs, sizeBytes: stat.size, path: filePath, previewUrl: mediaUrlForPath(filePath),
      color: '#4f8cff', libraryTabId: tabId, waveform, fingerprint: hash, integrity: verifyIntegrity ? 'valid' : 'unchecked', analysis: inspected.analysis
    }, log: { path: filePath, name, outcome: 'imported', detail: verifyIntegrity ? 'Fully decoded and verified' : 'Metadata verified' } });
  });
  const assets = results.filter(item => item.outcome === 'imported').map(item => item.asset);
  const quarantined = results.filter(item => item.outcome === 'quarantined').map(item => item.item);
  const duplicates = results.filter(item => item.outcome === 'duplicate').length;
  const fallback = inputPaths.length === 1 ? inputPaths[0] : path.dirname(inputPaths[0] || 'Lista importada');
  return { assets, quarantined, folderImport, suggestedName: inferCollectionName(files, fallback), log: {
    id: crypto.randomUUID(), startedAt, finishedAt: new Date().toISOString(), sourceCount: files.length,
    importedCount: assets.length, quarantinedCount: quarantined.length, duplicateCount: duplicates, entries: results.map(item => item.log)
  } };
};

const quarantine = (kind: string, filePath: string, sizeBytes: number, hash: string, reason: string, detail: string) => ({
  id: `quarantine-${crypto.randomUUID()}`, kind, name: path.basename(filePath), path: filePath,
  previewUrl: mediaUrlForPath(filePath), sizeBytes, durationMs: 0, fingerprint: hash, reason, detail, importedAt: new Date().toISOString()
});
