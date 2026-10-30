import type { ChildProcess } from 'node:child_process';

const dbToGain = (db: number) => Math.max(0, 10 ** (db / 20));
const number = (value: number) => Number(value.toFixed(6));

const groupValue = (automation: any, id: string, fallback: number) => automation?.groups?.find((item: any) => item.id === id)?.value ?? fallback;

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
    expression = `if(lt(${global},${number(rightTime)}),${value},${expression})`;
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
      up: groupValue(automation, assignment?.fadeUpGroupId, payload.audioSettings.fadeUpMs) / 1000
    };
  });
  let baseline = number(dbToGain(payload.audioSettings.musicGainDb)).toString();
  for (let index = settings.length - 1; index >= 0; index -= 1) {
    baseline = `if(lt(${global},${number(settings[index].voice.startMs / 1000)}),${number(settings[index].high)},${baseline})`;
  }
  const envelopes = settings.map(({ voice, high, low, down, up }) => {
    const start = voice.startMs / 1000;
    const end = (voice.startMs + voice.durationMs) / 1000;
    const downStart = start - down;
    const upEnd = end + up;
    const downValue = down > 0 ? `(${number(high)}+(${number(low - high)})*(${global}-${number(downStart)})/${number(down)})` : number(low).toString();
    const upValue = up > 0 ? `(${number(low)}+(${number(high - low)})*(${global}-${number(end)})/${number(up)})` : number(high).toString();
    return `if(between(${global},${number(downStart)},${number(start)}),${downValue},if(between(${global},${number(start)},${number(end)}),${number(low)},if(between(${global},${number(end)},${number(upEnd)}),${upValue},1)))`;
  });
  return envelopes.reduce((result, envelope) => `min(${result},${envelope})`, baseline);
};

export const buildExportPlan = (payload: any) => {
  const assets = new Map(payload.assets.map((asset: any) => [asset.id, asset]));
  const clips = [...payload.arrangement.music, ...payload.arrangement.voice].filter((clip: any) => clip.kind !== 'missing' && clip.assetId);
  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];
  clips.forEach((clip: any, index: number) => {
    const asset: any = assets.get(clip.assetId);
    if (!asset?.path) return;
    inputs.push('-i', asset.path);
    const tab = payload.libraryTabs.find((item: any) => item.id === clip.libraryTabId);
    const local = tab?.localAutomationEnabled ? automationExpression(tab.automationPoints, payload.arrangement.durationMs, clip.startMs) : '1';
    const adjustment = asset.analysis ? Math.min(
      (payload.audioSettings.normalizationTargetLufs ?? -23) - asset.analysis.integratedLufs,
      (payload.audioSettings.truePeakCeilingDbtp ?? -1) - asset.analysis.truePeakDbtp
    ) : 0;
    const normalization = payload.audioSettings.normalizeClips && asset.analysis ? 10 ** (adjustment / 20) : 1;
    const sourceBase = clip.kind === 'music' ? musicExpression(clip, payload) : number(dbToGain(payload.audioSettings.voiceGainDb)).toString();
    const base = `(${sourceBase})*${number(normalization)}`;
    const chain = [`[${labels.length}:a]atrim=0:${number(clip.durationMs / 1000)}`, 'asetpts=PTS-STARTPTS'];
    if (clip.fadeInMs) chain.push(`afade=t=in:st=0:d=${number(Math.min(clip.fadeInMs, clip.durationMs) / 1000)}`);
    if (clip.fadeOutMs) chain.push(`afade=t=out:st=${number(Math.max(0, clip.durationMs - clip.fadeOutMs) / 1000)}:d=${number(Math.min(clip.fadeOutMs, clip.durationMs) / 1000)}`);
    chain.push(`volume='(${base})*(${local})':eval=frame`, `adelay=${Math.round(clip.startMs)}|${Math.round(clip.startMs)}`);
    const label = `clip${labels.length}`;
    filters.push(`${chain.join(',')}[${label}]`);
    labels.push(label);
  });
  if (labels.length === 0) throw new Error('The arrangement has no playable clips');
  let finishing = '';
  if (payload.audioSettings.echoEnabled) finishing += `,aecho=0.8:${number((payload.audioSettings.echoMix ?? 15) / 100)}:${Math.round(payload.audioSettings.echoDelayMs ?? 260)}:${number((payload.audioSettings.echoFeedback ?? 30) / 100)}`;
  if (payload.audioSettings.reverbEnabled) finishing += `,aecho=0.85:${number((payload.audioSettings.reverbMix ?? 15) / 100)}:45|90|180:0.45|0.3|0.18`;
  if (payload.exportOptions?.normalize) finishing += ',loudnorm=I=-14:LRA=11:TP=-1.5';
  filters.push(`${labels.map(label => `[${label}]`).join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,atrim=0:${number(payload.arrangement.durationMs / 1000)}${finishing}[out]`);
  return { inputs, filterScript: filters.join(';\n') };
};

export const codecArguments = (options: any): string[] => {
  if (options.format === 'wav') return ['-c:a', options.bitDepth === 32 ? 'pcm_f32le' : `pcm_s${options.bitDepth}le`];
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
