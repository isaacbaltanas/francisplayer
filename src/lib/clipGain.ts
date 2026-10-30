import type { LibraryTab, TimelineClip, TrackAutomationPoint } from '../types';

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export const clipFadeGain = (clip: TimelineClip, positionMs: number): number => {
  const elapsed = positionMs - clip.startMs;
  const remaining = clip.startMs + clip.durationMs - positionMs;
  const fadeIn = clip.fadeInMs ? clamp(elapsed / clip.fadeInMs) : 1;
  const fadeOut = clip.fadeOutMs ? clamp(remaining / clip.fadeOutMs) : 1;
  return Math.min(fadeIn, fadeOut);
};

export const automationValueAt = (points: TrackAutomationPoint[], position: number): number => {
  const sorted = [...points].sort((a, b) => a.position - b.position);
  if (sorted.length === 0) return 100;
  if (position <= sorted[0].position) return sorted[0].value;
  if (position >= sorted[sorted.length - 1].position) return sorted[sorted.length - 1].value;
  const rightIndex = sorted.findIndex(point => point.position >= position);
  const left = sorted[rightIndex - 1];
  const right = sorted[rightIndex];
  const ratio = (position - left.position) / Math.max(.000001, right.position - left.position);
  return left.value + (right.value - left.value) * ratio;
};

export const trackAutomationGain = (clip: TimelineClip, tabs: LibraryTab[], positionMs: number, durationMs: number): number => {
  const tab = tabs.find(item => item.id === clip.libraryTabId);
  if (!tab?.localAutomationEnabled) return 1;
  return clamp(automationValueAt(tab.automationPoints, positionMs / Math.max(1, durationMs)) / 100);
};
