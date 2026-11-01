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

export const durationToIncludeAllMusic = (assets: MediaAsset[], currentDurationMs: number) => (
  Math.max(currentDurationMs, assets.reduce((sum, asset) => sum + Math.max(0, asset.durationMs), 0))
);

export const rebuildMissingMusic = (clips: TimelineClip[], durationMs: number): TimelineClip[] => {
  const content = clips.filter(clip => clip.kind === 'music').sort((a, b) => a.startMs - b.startMs);
  const missing: TimelineClip[] = [];
  let coveredUntil = 0;
  for (const clip of content) {
    if (clip.startMs > coveredUntil) missing.push({
      id: `missing-${coveredUntil}-${clip.startMs}`,
      kind: 'missing', name: 'missingMusic', startMs: coveredUntil, generatedStartMs: coveredUntil,
      durationMs: clip.startMs - coveredUntil, color: '#ce4a54'
    });
    coveredUntil = Math.max(coveredUntil, clip.startMs + clip.durationMs);
  }
  if (coveredUntil < durationMs) missing.push({
    id: `missing-${coveredUntil}-${durationMs}`,
    kind: 'missing', name: 'missingMusic', startMs: coveredUntil, generatedStartMs: coveredUntil,
    durationMs: durationMs - coveredUntil, color: '#ce4a54'
  });
  return [...content, ...missing].sort((a, b) => a.startMs - b.startMs || (a.kind === 'missing' ? -1 : 1));
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
  generatedStartMs: startMs,
  durationMs,
  sourceDurationMs: asset.durationMs,
  sourceOffsetMs: asset.trimStartMs ?? 0,
  originalSourceDurationMs: asset.sourceDurationMs ?? asset.durationMs,
  color: asset.color,
  libraryTabId: asset.libraryTabId,
  truncated: durationMs < asset.durationMs,
  fadeOutMs: durationMs < asset.durationMs ? Math.min(5_000, durationMs) : undefined
});

export const voiceScheduleDuration = (assets: MediaAsset[], intervalMs: number, allowOverlap: boolean): number => {
  let previousEnd = 0;
  let scheduledStart = Math.max(0, intervalMs);
  assets.filter(asset => asset.durationMs > 0).forEach(asset => {
    const startMs = allowOverlap ? scheduledStart : Math.max(scheduledStart, previousEnd);
    previousEnd = Math.max(previousEnd, startMs + asset.durationMs);
    scheduledStart += Math.max(0, intervalMs);
  });
  return Math.max(1_000, previousEnd);
};

export const intervalForVoiceDuration = (assets: MediaAsset[], targetDurationMs: number, allowOverlap: boolean): number => {
  if (!assets.length) return 0;
  let low = 0;
  let high = 1_200_000;
  for (let index = 0; index < 24; index += 1) {
    const middle = (low + high) / 2;
    if (voiceScheduleDuration(assets, middle, allowOverlap) <= targetDurationMs) low = middle;
    else high = middle;
  }
  let result = Math.round(low / 1000) * 1000;
  while (result > 0 && voiceScheduleDuration(assets, result, allowOverlap) > targetDurationMs) result -= 1000;
  return result;
};

export const preserveManualVoicePositions = (previous: TimelineClip[], generated: TimelineClip[], durationMs: number,
  preserveManualSourceTrims = true): TimelineClip[] => {
  const queues = new Map<string, TimelineClip[]>();
  previous.forEach(clip => {
    const key = clip.assetId ?? clip.id;
    queues.set(key, [...(queues.get(key) ?? []), clip]);
  });
  const used = new Set<string>();
  const merged = generated.map(clip => {
    const queue = queues.get(clip.assetId ?? clip.id) ?? [];
    const old = queue.shift();
    if (!old) return clip;
    used.add(old.id);
    if (preserveManualSourceTrims && old.sourceTrimManuallyAdjusted) {
      const startMs = Math.max(0, Math.min(old.startMs, durationMs - old.durationMs));
      return { ...clip, id: old.id, startMs, durationMs: old.durationMs, sourceDurationMs: old.durationMs,
        sourceOffsetMs: old.sourceOffsetMs, originalSourceDurationMs: old.originalSourceDurationMs,
        sourceTrimManuallyAdjusted: true, manuallyPositioned: old.manuallyPositioned,
        fadeInMs: Math.min(old.fadeInMs ?? 0, old.durationMs), fadeOutMs: Math.min(old.fadeOutMs ?? 0, old.durationMs) };
    }
    if (!old.manuallyPositioned) return { ...clip, id: old.id, fadeInMs: old.fadeInMs, fadeOutMs: old.fadeOutMs ?? clip.fadeOutMs };
    const startMs = Math.max(0, Math.min(old.startMs, durationMs - clip.durationMs));
    return { ...clip, id: old.id, startMs,
      fadeInMs: Math.min(old.fadeInMs ?? 0, clip.durationMs), fadeOutMs: Math.min(old.fadeOutMs ?? clip.fadeOutMs ?? 0, clip.durationMs),
      manuallyPositioned: true };
  });
  previous.filter(clip => clip.manuallyPositioned && !used.has(clip.id)).forEach(old => {
    merged.push({ ...old, startMs: Math.max(0, Math.min(old.startMs, durationMs - old.durationMs)) });
  });
  return merged.sort((left, right) => left.startMs - right.startMs);
};

export const createArrangement = (
  musicAssets: MediaAsset[],
  voiceAssets: MediaAsset[],
  settings: ArrangementSettings
): Arrangement => {
  const validMusicAssets = musicAssets.filter(asset => asset.durationMs > 0);
  const validVoiceAssets = voiceAssets.filter(asset => asset.durationMs > 0);
  const warnings: string[] = [];
  const music: TimelineClip[] = [];
  const voice: TimelineClip[] = [];
  const voices = settings.voiceOrder === 'random'
    ? shuffleWithSeed(validVoiceAssets, settings.seed + 10_000)
    : [...validVoiceAssets];
  const minimumVoiceDuration = settings.allowVoiceOverlap
    ? Math.max(0, ...voices.map(asset => asset.durationMs))
    : voices.reduce((sum, asset) => sum + asset.durationMs, 0);
  const durationMs = Math.max(1_000, settings.targetDurationMs, minimumVoiceDuration);
  if (durationMs > settings.targetDurationMs) warnings.push('durationExtendedForVoices');

  if (validMusicAssets.length === 0) {
    music.push({
      id: 'missing-all', kind: 'missing', name: 'missingMusic', startMs: 0,
      generatedStartMs: 0,
      durationMs, color: '#ce4a54'
    });
    warnings.push('missingMusic');
  } else {
    let cursor = 0;
    let cycle = 0;
    const fillMode = settings.musicFillMode ?? (settings.repeatMusic ? 'repeat' : 'silence');
    while (cursor < durationMs) {
      const sequence = fillMode === 'random' && cycle > 0
        ? shuffleWithSeed(validMusicAssets, settings.seed + cycle)
        : ordered(validMusicAssets, settings.musicOrder, settings.seed + (settings.musicOrder === 'random' ? cycle : 0));
      for (const asset of sequence) {
        const remaining = durationMs - cursor;
        if (remaining <= 0) break;
        const clipDuration = Math.min(asset.durationMs, remaining);
        music.push(makeClip(asset, cursor, clipDuration));
        cursor += clipDuration;
      }
      if (fillMode === 'silence') break;
      cycle += 1;
    }
    if (cursor < durationMs) {
      music.push({
        id: `missing-${cursor}`, kind: 'missing', name: 'missingMusic', startMs: cursor,
        generatedStartMs: cursor,
        durationMs: durationMs - cursor, color: '#ce4a54'
      });
      warnings.push('missingMusic');
    }
  }

  if (voices.length > 0) {
    if (settings.voicePlacement === 'uniform') {
      if (settings.allowVoiceOverlap) {
        const slot = durationMs / (voices.length + 1);
        voices.forEach((asset, index) => voice.push(makeClip(asset,
          Math.max(0, Math.min(durationMs - asset.durationMs, Math.round(slot * (index + 1) - asset.durationMs / 2))))));
      } else {
        const freeSpace = Math.max(0, durationMs - voices.reduce((sum, asset) => sum + asset.durationMs, 0));
        const gap = freeSpace / (voices.length + 1);
        let cursor = gap;
        voices.forEach(asset => { voice.push(makeClip(asset, Math.round(cursor))); cursor += asset.durationMs + gap; });
      }
    } else {
      const fittedInterval = Math.min(settings.voiceIntervalMs,
        intervalForVoiceDuration(voices, durationMs, settings.allowVoiceOverlap));
      if (fittedInterval < settings.voiceIntervalMs) warnings.push('voiceSpacingReduced');
      let scheduledStart = fittedInterval;
      let previousEnd = 0;
      voices.forEach((asset) => {
        let startMs = scheduledStart;
        if (!settings.allowVoiceOverlap) startMs = Math.max(startMs, previousEnd);
        startMs = Math.max(0, Math.min(durationMs - asset.durationMs, startMs));
        voice.push(makeClip(asset, startMs));
        previousEnd = startMs + asset.durationMs;
        scheduledStart += fittedInterval;
      });
    }
  }

  return { durationMs, music, voice, warnings: [...new Set(warnings)] };
};

export const allocateClipLanes = (clips: TimelineClip[]): TimelineClip[][] => {
  const lanes: TimelineClip[][] = [];
  [...clips].sort((left, right) => left.startMs - right.startMs || left.durationMs - right.durationMs).forEach(clip => {
    const laneIndex = lanes.findIndex(lane => {
      const last = lane[lane.length - 1];
      return !last || last.startMs + last.durationMs <= clip.startMs;
    });
    if (laneIndex >= 0) lanes[laneIndex].push(clip); else lanes.push([clip]);
  });
  return lanes.length ? lanes : [[]];
};

export const rippleMoveMusicClip = (
  arrangement: Arrangement,
  clipId: string,
  nextStartMs: number,
  assets: MediaAsset[],
  settings: ArrangementSettings,
  isolated = false
): Arrangement => {
  const selected = arrangement.music.find(clip => clip.id === clipId && clip.kind === 'music');
  if (!selected) return arrangement;
  const anchorMs = selected.startMs;
  const deltaMs = nextStartMs - anchorMs;
  if (Math.abs(deltaMs) < 1) return arrangement;
  const shiftedMusic = arrangement.music.filter(clip => clip.kind === 'music').map(clip => {
    const affected = isolated ? clip.id === clipId : clip.startMs >= anchorMs;
    return affected ? { ...clip, startMs: Math.max(0, clip.startMs + deltaMs), manuallyPositioned: true } : clip;
  });
  const shiftedVoice = arrangement.voice.map(clip => !isolated && clip.startMs >= anchorMs
    ? { ...clip, startMs: Math.max(0, clip.startMs + deltaMs), manuallyPositioned: true } : clip);
  const durationMs = Math.max(arrangement.durationMs,
    ...shiftedVoice.map(clip => clip.startMs + clip.durationMs));
  let music = shiftedMusic.filter(clip => clip.startMs < durationMs).map(clip => {
    const available = durationMs - clip.startMs;
    if (clip.durationMs <= available) return clip;
    return { ...clip, durationMs: available, truncated: true, fadeOutMs: Math.min(5_000, available) };
  });

  if (!isolated) {
    let cursor = Math.max(0, ...music.map(clip => clip.startMs + clip.durationMs));
    const fillMode = settings.musicFillMode ?? (settings.repeatMusic ? 'repeat' : 'silence');
    const candidates = assets.filter(asset => asset.kind === 'music' && asset.durationMs > 0);
    let cycle = 0;
    while (cursor < durationMs && candidates.length && fillMode !== 'silence') {
      const sequence = fillMode === 'random' ? shuffleWithSeed(candidates, settings.seed + 50_000 + cycle) : candidates;
      for (const asset of sequence) {
        const remaining = durationMs - cursor;
        if (remaining <= 0) break;
        const clip = makeClip(asset, cursor, Math.min(asset.durationMs, remaining));
        music.push({ ...clip, id: `${clip.id}-ripple-${cycle}`, manuallyPositioned: true });
        cursor += clip.durationMs;
      }
      cycle += 1;
    }
  }

  music = rebuildMissingMusic(music, durationMs);
  const hasMissing = music.some(clip => clip.kind === 'missing');
  const warnings = arrangement.warnings.filter(warning => warning !== 'missingMusic');
  if (hasMissing) warnings.push('missingMusic');
  return { ...arrangement, durationMs, music, voice: shiftedVoice, warnings: [...new Set(warnings)] };
};
