import type { ChildProcess } from 'node:child_process';

const dbToGain = (db: number) => Math.max(0, 10 ** (db / 20));
const number = (value: number) => Number(value.toFixed(6));

const effectsFilter = (settings: any) => {
  const delays: number[] = [];
  const decays: number[] = [];
  if (settings.echoEnabled) {
    const delay = Math.max(1, settings.echoDelayMs ?? 260);
    const feedback = Math.max(0, Math.min(.9, (settings.echoFeedback ?? 30) / 100));
    const mix = Math.max(0, Math.min(1, (settings.echoMix ?? 15) / 100));
    for (let tap = 1; tap <= 8; tap += 1) {
      delays.push(Math.round(delay * tap));
      decays.push(number(mix * feedback ** (tap - 1)));
    }
  }
  if (settings.reverbEnabled) {
    const mix = Math.max(0, Math.min(1, (settings.reverbMix ?? 15) / 100));
    const durationMs = Math.max(100, Math.min(10_000, (settings.reverbDuration ?? 1.8) * 1000));
    const decay = Math.max(.1, settings.reverbDecay ?? 2.4);
    [0.025, 0.037, 0.053, 0.079, 0.113, 0.167, 0.239, 0.337, 0.463, 0.617, 0.79, 1].forEach(ratio => {
      delays.push(Math.max(1, Math.round(durationMs * ratio)));
      decays.push(number(mix * .35 * Math.exp(-decay * ratio)));
    });
  }
  return delays.length ? `,aecho=1:1:${delays.join('|')}:${decays.join('|')}` : '';
};

const groupValue = (automation: any, id: string, fallback: number) => automation?.groups?.find((item: any) => item.id === id)?.value ?? fallback;
const groupOffset = (automation: any, id: string, fallback: number) => automation?.groups?.find((item: any) => item.id === id)?.offsetMs ?? fallback;

const automationExpression = (points: any[], durationMs: number, clipStartMs: number) => {
  const sorted = [...(points || [])].sort((a, b) => a.position - b.position);
  if (sorted.length === 0) return '1';
  const global = `(t+${number(clipStartMs / 1000)})`;
  let expression = number((sorted[sorted.length - 1].value ?? 100) / 100).toString();
  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    const leftTime = left.position * durationMs / 1000;
    const rightTime = right.position * durationMs / 1000;
    const span = Math.max(.000001, rightTime - leftTime);
    const value = `(${number(left.value / 100)}+(${number((right.value - left.value) / 100)})*(${global}-${number(leftTime)})/${number(span)})`;
    expression = `if(lt(${global},${number(rightTime)}),if(lt(${global},${number(leftTime)}),${number(left.value / 100)},${value}),${expression})`;
  }
  return expression;
};

const musicExpression = (clip: any, payload: any) => {
  const automation = payload.automation;
  const fallbackHigh = dbToGain(payload.audioSettings.musicGainDb) * 100;
  const fallbackLow = dbToGain(payload.audioSettings.duckingGainDb) * 100;
  const global = `(t+${number(clip.startMs / 1000)})`;
  const voices = [...payload.arrangement.voice].sort((a: any, b: any) => a.startMs - b.startMs);
  const settings = voices.map((voice: any) => {
    const assignment = automation?.assignments?.find((item: any) => item.voiceClipId === voice.id);
    return {
      voice,
      high: groupValue(automation, assignment?.highGroupId, fallbackHigh) / 100,
      low: groupValue(automation, assignment?.lowGroupId, fallbackLow) / 100,
      down: groupValue(automation, assignment?.fadeDownGroupId, payload.audioSettings.fadeDownMs) / 1000,
      up: groupValue(automation, assignment?.fadeUpGroupId, payload.audioSettings.fadeUpMs) / 1000,
      downOverlap: groupOffset(automation, assignment?.fadeDownGroupId, payload.audioSettings.fadeDownOverlapMs ?? 0) / 1000,
      upOverlap: groupOffset(automation, assignment?.fadeUpGroupId, payload.audioSettings.fadeUpOverlapMs ?? 0) / 1000
    };
  });
  let baseline = number(dbToGain(payload.audioSettings.musicGainDb)).toString();
  for (let index = settings.length - 1; index >= 0; index -= 1) {
    baseline = `if(lt(${global},${number(settings[index].voice.startMs / 1000)}),${number(settings[index].high)},${baseline})`;
  }
  const envelopes = settings.map(({ voice, high, low, down, up, downOverlap, upOverlap }) => {
    const start = voice.startMs / 1000;
    const end = (voice.startMs + voice.durationMs) / 1000;
    const duration = voice.durationMs / 1000;
    const effectiveDownOverlap = Math.min(duration, down, Math.max(0, downOverlap));
    const effectiveUpOverlap = Math.min(Math.max(0, duration - effectiveDownOverlap), up, Math.max(0, upOverlap));
    const downEnd = start + effectiveDownOverlap;
    const downStart = downEnd - down;
    const upStart = end - effectiveUpOverlap;
    const upEnd = upStart + up;
    const downValue = down > 0 ? `(${number(high)}+(${number(low - high)})*(${global}-${number(downStart)})/${number(down)})` : number(low).toString();
    const upValue = up > 0 ? `(${number(low)}+(${number(high - low)})*(${global}-${number(upStart)})/${number(up)})` : number(high).toString();
    return `if(between(${global},${number(downStart)},${number(downEnd)}),${downValue},if(between(${global},${number(downEnd)},${number(upStart)}),${number(low)},if(between(${global},${number(upStart)},${number(upEnd)}),${upValue},1)))`;
  });
  return envelopes.reduce((result, envelope) => `min(${result},${envelope})`, baseline);
};

export const buildExportPlan = (payload: any) => {
  const assets = new Map(payload.assets.map((asset: any) => [asset.id, asset]));
  const clips = [...payload.arrangement.music, ...payload.arrangement.voice].filter((clip: any) => clip.kind !== 'missing' && clip.assetId);
  const resolved = clips.map((clip: any) => {
    const asset: any = assets.get(clip.assetId);
    if (!asset?.path) throw new Error(`Missing source for clip: ${clip.name || clip.id}`);
    return { clip, asset };
  });
  const uniquePaths = [...new Set(resolved.map(({ asset }: any) => asset.path))];
  const inputIndex = new Map(uniquePaths.map((sourcePath, index) => [sourcePath, index]));
  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];
  uniquePaths.forEach(sourcePath => inputs.push('-i', sourcePath as string));
  const sourceLabels = new Map<string, string[]>();
  uniquePaths.forEach(sourcePath => {
    const count = resolved.filter(({ asset }: any) => asset.path === sourcePath).length;
    const index = inputIndex.get(sourcePath)!;
    if (count === 1) sourceLabels.set(sourcePath, [`[${index}:a]`]);
    else {
      const splitLabels = Array.from({ length: count }, (_, occurrence) => `source${index}_${occurrence}`);
      filters.push(`[${index}:a]asplit=${count}${splitLabels.map(label => `[${label}]`).join('')}`);
      sourceLabels.set(sourcePath, splitLabels.map(label => `[${label}]`));
    }
  });
  const sourceOccurrences = new Map<string, number>();
  resolved.forEach(({ clip, asset }: any) => {
    const occurrence = sourceOccurrences.get(asset.path) ?? 0;
    sourceOccurrences.set(asset.path, occurrence + 1);
    const sourceLabel = sourceLabels.get(asset.path)![occurrence];
    const tab = payload.libraryTabs.find((item: any) => item.id === clip.libraryTabId);
    const local = tab?.localAutomationEnabled ? automationExpression(tab.automationPoints, payload.arrangement.durationMs, clip.startMs) : '1';
    const adjustment = asset.analysis ? Math.max(-30, Math.min(30,
      (payload.audioSettings.normalizationTargetLufs ?? -23) - asset.analysis.integratedLufs,
      (payload.audioSettings.truePeakCeilingDbtp ?? -1) - asset.analysis.truePeakDbtp
    )) : 0;
    const normalization = payload.audioSettings.normalizeClips && asset.analysis ? 10 ** (adjustment / 20) : 1;
    const sourceBase = clip.kind === 'music' ? musicExpression(clip, payload) : number(dbToGain(payload.audioSettings.voiceGainDb)).toString();
    const base = `(${sourceBase})*${number(normalization)}`;
    const sourceStart = (clip.sourceOffsetMs ?? 0) / 1000;
    const chain = [`${sourceLabel}atrim=start=${number(sourceStart)}:end=${number(sourceStart + clip.durationMs / 1000)}`, 'asetpts=PTS-STARTPTS'];
    if (clip.kind === 'music') chain.push('asetnsamples=n=128:p=1');
    if (clip.kind === 'voice') {
      const technicalFade = Math.min(.008, clip.durationMs / 2000);
      chain.push(`afade=t=in:st=0:d=${number(technicalFade)}`,
        `afade=t=out:st=${number(Math.max(0, clip.durationMs / 1000 - technicalFade))}:d=${number(technicalFade)}`);
    }
    if (clip.fadeInMs) chain.push(`afade=t=in:st=0:d=${number(Math.min(clip.fadeInMs, clip.durationMs) / 1000)}`);
    if (clip.fadeOutMs) chain.push(`afade=t=out:st=${number(Math.max(0, clip.durationMs - clip.fadeOutMs) / 1000)}:d=${number(Math.min(clip.fadeOutMs, clip.durationMs) / 1000)}`);
    chain.push(`volume='(${base})*(${local})':eval=frame${clip.kind === 'voice' ? effectsFilter(payload.audioSettings) : ''}`,
      `adelay=${Math.round(clip.startMs)}|${Math.round(clip.startMs)}`);
    const label = `clip${labels.length}`;
    filters.push(`${chain.join(',')}[${label}]`);
    labels.push(label);
  });
  if (labels.length === 0) throw new Error('The arrangement has no playable clips');
  const durationSeconds = number(payload.arrangement.durationMs / 1000);
  filters.push(`${labels.map(label => `[${label}]`).join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,apad=whole_dur=${durationSeconds},atrim=start=0:end=${durationSeconds},asetpts=PTS-STARTPTS[out]`);
  return { inputs, filterScript: filters.join(';\n'), manifest: resolved.map(({ clip, asset }: any) => ({
    clipId: clip.id, assetId: asset.id, path: asset.path, startMs: clip.startMs, durationMs: clip.durationMs, kind: clip.kind
  })) };
};

export const codecArguments = (options: any): string[] => {
  if (options.format === 'wav') return ['-c:a', options.bitDepth === 32 ? 'pcm_f32le' : `pcm_s${options.bitDepth}le`, '-rf64', 'auto', '-write_bext', '1'];
  if (options.format === 'flac') return ['-c:a', 'flac', '-sample_fmt', options.bitDepth === 16 ? 's16' : 's32', '-compression_level', String(options.compressionLevel ?? 5)];
  if (options.format === 'aac') return ['-c:a', 'aac', '-b:a', `${options.bitrate}k`];
  if (options.format === 'ogg') return ['-c:a', 'libvorbis', '-b:a', `${options.bitrate}k`];
  if (options.format === 'opus') return ['-c:a', 'libopus', '-b:a', `${options.bitrate}k`];
  return ['-c:a', 'libmp3lame', '-b:a', `${options.bitrate}k`];
};

export const parseProgress = (line: string, durationMs: number) => {
  const match = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  if (!match) return null;
  const milliseconds = (+match[1] * 3600 + +match[2] * 60 + +match[3]) * 1000;
  return Math.max(0, Math.min(100, milliseconds / Math.max(1, durationMs) * 100));
};

export const collectProcessResult = (process: ChildProcess) => new Promise<void>((resolve, reject) => {
  process.once('error', reject);
  process.once('exit', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${code}`)));
});
