import { calculateDuckingDb } from './audio';
import type {
  Arrangement, AudioSettings, AutomationAssignment, AutomationGroup,
  AutomationGroupType, AutomationState, TimelineClip
} from '../types';

const colors: Record<AutomationGroupType, string[]> = {
  high: ['#71f6ca', '#67d9ff', '#b893ff', '#ffca6b'],
  low: ['#ff6f91', '#ff9e64', '#df79ff', '#70d9ff'],
  fadeDown: ['#d4ff62', '#62f5ff', '#ff85d7', '#ffc85c'],
  fadeUp: ['#8dff68', '#65d8ff', '#d98aff', '#ffb65e']
};

export const percentToDb = (percent: number) => percent <= 0 ? -80 : Math.max(-80, 20 * Math.log10(percent / 100));
export const dbToPercent = (db: number) => Math.max(0, Math.min(100, 100 * 10 ** (db / 20)));

const group = (type: AutomationGroupType, index: number, value: number): AutomationGroup => ({
  id: `${type}-${index}-${crypto.randomUUID()}`,
  type,
  index,
  value,
  color: colors[type][(index - 1) % colors[type].length]
});

export const createAutomationState = (arrangement: Arrangement, audio: AudioSettings): AutomationState => {
  const high = group('high', 1, dbToPercent(audio.musicGainDb));
  const low = group('low', 1, dbToPercent(audio.duckingGainDb));
  const fadeDown = group('fadeDown', 1, audio.fadeDownMs);
  const fadeUp = group('fadeUp', 1, audio.fadeUpMs);
  return {
    displayUnit: 'percent',
    visible: true,
    groups: [high, low, fadeDown, fadeUp],
    assignments: arrangement.voice.map(clip => ({
      voiceClipId: clip.id,
      highGroupId: high.id,
      lowGroupId: low.id,
      fadeDownGroupId: fadeDown.id,
      fadeUpGroupId: fadeUp.id
    }))
  };
};

export const getGroup = (state: AutomationState, id: string) => state.groups.find(item => item.id === id);

export const assignmentKey = (type: AutomationGroupType): keyof Omit<AutomationAssignment, 'voiceClipId'> => {
  if (type === 'high') return 'highGroupId';
  if (type === 'low') return 'lowGroupId';
  if (type === 'fadeDown') return 'fadeDownGroupId';
  return 'fadeUpGroupId';
};

export const updateAutomationGroup = (state: AutomationState, groupId: string, value: number): AutomationState => ({
  ...state,
  groups: state.groups.map(item => item.id === groupId ? { ...item, value } : item)
});

export const syncDefaultAutomationGroups = (
  state: AutomationState,
  patch: Partial<AudioSettings>
): AutomationState => ({
  ...state,
  groups: state.groups.map(item => {
    if (item.index !== 1) return item;
    if (item.type === 'high' && patch.musicGainDb !== undefined) return { ...item, value: dbToPercent(patch.musicGainDb) };
    if (item.type === 'low' && patch.duckingGainDb !== undefined) return { ...item, value: dbToPercent(patch.duckingGainDb) };
    if (item.type === 'fadeDown' && patch.fadeDownMs !== undefined) return { ...item, value: patch.fadeDownMs };
    if (item.type === 'fadeUp' && patch.fadeUpMs !== undefined) return { ...item, value: patch.fadeUpMs };
    return item;
  })
});

export const detachAutomationGroup = (
  state: AutomationState,
  voiceClipId: string,
  type: AutomationGroupType
): { state: AutomationState; groupId: string } => {
  const assignment = state.assignments.find(item => item.voiceClipId === voiceClipId);
  const key = assignmentKey(type);
  const source = assignment && getGroup(state, assignment[key]);
  if (!assignment || !source) return { state, groupId: '' };
  const nextIndex = Math.max(0, ...state.groups.filter(item => item.type === type).map(item => item.index)) + 1;
  const next = group(type, nextIndex, source.value);
  return {
    groupId: next.id,
    state: {
      ...state,
      groups: [...state.groups, next],
      assignments: state.assignments.map(item => item.voiceClipId === voiceClipId ? { ...item, [key]: next.id } : item)
    }
  };
};

export const assignAutomationGroup = (
  state: AutomationState,
  voiceClipId: string,
  type: AutomationGroupType,
  groupId: string
): AutomationState => {
  const key = assignmentKey(type);
  return {
    ...state,
    assignments: state.assignments.map(item => item.voiceClipId === voiceClipId ? { ...item, [key]: groupId } : item)
  };
};

export const addAutomationAssignment = (state: AutomationState, voiceClipId: string): AutomationState => {
  if (state.assignments.some(item => item.voiceClipId === voiceClipId)) return state;
  const first = (type: AutomationGroupType) => state.groups.find(item => item.type === type)?.id ?? '';
  return {
    ...state,
    assignments: [...state.assignments, {
      voiceClipId,
      highGroupId: first('high'),
      lowGroupId: first('low'),
      fadeDownGroupId: first('fadeDown'),
      fadeUpGroupId: first('fadeUp')
    }]
  };
};

export const removeAutomationAssignment = (state: AutomationState, voiceClipId: string): AutomationState => ({
  ...state,
  assignments: state.assignments.filter(item => item.voiceClipId !== voiceClipId)
});

const settingsFor = (state: AutomationState, assignment: AutomationAssignment, fallback: AudioSettings): AudioSettings => ({
  ...fallback,
  musicGainDb: percentToDb(getGroup(state, assignment.highGroupId)?.value ?? dbToPercent(fallback.musicGainDb)),
  duckingGainDb: percentToDb(getGroup(state, assignment.lowGroupId)?.value ?? dbToPercent(fallback.duckingGainDb)),
  fadeDownMs: getGroup(state, assignment.fadeDownGroupId)?.value ?? fallback.fadeDownMs,
  fadeUpMs: getGroup(state, assignment.fadeUpGroupId)?.value ?? fallback.fadeUpMs
});

export const calculateGroupedDuckingDb = (
  positionMs: number,
  voiceClips: TimelineClip[],
  state: AutomationState | null,
  fallback: AudioSettings
) => {
  if (!state || voiceClips.length === 0) return calculateDuckingDb(positionMs, voiceClips, fallback);
  const sorted = [...voiceClips].sort((a, b) => a.startMs - b.startMs);
  const nextClip = sorted.find(clip => positionMs < clip.startMs) ?? sorted[sorted.length - 1];
  const nextAssignment = state.assignments.find(item => item.voiceClipId === nextClip.id);
  let result = nextAssignment ? settingsFor(state, nextAssignment, fallback).musicGainDb : fallback.musicGainDb;

  for (const clip of sorted) {
    const assignment = state.assignments.find(item => item.voiceClipId === clip.id);
    if (!assignment) continue;
    const local = settingsFor(state, assignment, fallback);
    const start = clip.startMs - local.fadeDownMs;
    const end = clip.startMs + clip.durationMs + local.fadeUpMs;
    if (positionMs >= start && positionMs <= end) {
      result = Math.min(result, calculateDuckingDb(positionMs, [clip], local));
    }
  }
  return result;
};
