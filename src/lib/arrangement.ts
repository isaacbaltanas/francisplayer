import type { Arrangement, ArrangementSettings, MediaAsset, TimelineClip } from '../types';

const seededRandom = (seed: number) => {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
};

export const shuffleWithSeed = <T,>(items: T[], seed: number) => {
  const result = [...items];
  const random = seededRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
};

const ordered = (assets: MediaAsset[], mode: ArrangementSettings['musicOrder'], seed: number) => (
  mode === 'random' ? shuffleWithSeed(assets, seed) : [...assets]
);

const makeClip = (asset: MediaAsset, startMs: number, durationMs = asset.durationMs): TimelineClip => ({
  id: `clip-${asset.id}-${startMs}`,
  assetId: asset.id,
  kind: asset.kind,
  name: asset.name,
  startMs,
  durationMs,
  sourceDurationMs: asset.durationMs,
  color: asset.color,
  truncated: durationMs < asset.durationMs
});

export const createArrangement = (
  musicAssets: MediaAsset[],
  voiceAssets: MediaAsset[],
  settings: ArrangementSettings
): Arrangement => {
  const durationMs = Math.max(1_000, settings.targetDurationMs);
  const warnings: string[] = [];
  const music: TimelineClip[] = [];
  const voice: TimelineClip[] = [];

  if (musicAssets.length === 0) {
    music.push({
      id: 'missing-all', kind: 'missing', name: 'missingMusic', startMs: 0,
      durationMs, color: '#ce4a54'
    });
    warnings.push('missingMusic');
  } else {
    let cursor = 0;
    let cycle = 0;
    while (cursor < durationMs) {
      const sequence = ordered(musicAssets, settings.musicOrder, settings.seed + cycle);
      for (const asset of sequence) {
        const remaining = durationMs - cursor;
        if (remaining <= 0) break;
        const clipDuration = Math.min(asset.durationMs, remaining);
        music.push(makeClip(asset, cursor, clipDuration));
        cursor += clipDuration;
      }
      if (!settings.repeatMusic) break;
      cycle += 1;
    }
    if (cursor < durationMs) {
      music.push({
        id: `missing-${cursor}`, kind: 'missing', name: 'missingMusic', startMs: cursor,
        durationMs: durationMs - cursor, color: '#ce4a54'
      });
      warnings.push('missingMusic');
    }
  }

  const voices = settings.voiceOrder === 'random'
    ? shuffleWithSeed(voiceAssets, settings.seed + 10_000)
    : [...voiceAssets];

  if (voices.length > 0) {
    if (settings.voicePlacement === 'uniform') {
      const slot = durationMs / (voices.length + 1);
      let previousEnd = 0;
      voices.forEach((asset, index) => {
        let startMs = Math.max(0, Math.round(slot * (index + 1) - asset.durationMs / 2));
        if (!settings.allowVoiceOverlap) startMs = Math.max(startMs, previousEnd);
        if (startMs + asset.durationMs > durationMs) {
          warnings.push('voiceOutside');
          return;
        }
        voice.push(makeClip(asset, startMs));
        previousEnd = startMs + asset.durationMs;
      });
    } else {
      let scheduledStart = settings.voiceIntervalMs;
      let previousEnd = 0;
      voices.forEach((asset) => {
        let startMs = scheduledStart;
        if (!settings.allowVoiceOverlap) startMs = Math.max(startMs, previousEnd);
        if (startMs + asset.durationMs > durationMs) {
          warnings.push('voiceOutside');
          return;
        }
        voice.push(makeClip(asset, startMs));
        previousEnd = startMs + asset.durationMs;
        scheduledStart += settings.voiceIntervalMs;
      });
    }
  }

  return { durationMs, music, voice, warnings: [...new Set(warnings)] };
};
