import { shuffleWithSeed } from './arrangement';
import type { InsertionConfig, LibraryTab, MediaAsset } from '../types';

const queuesByTab = (tabs: LibraryTab[], assets: MediaAsset[]) => tabs.map(tab => ({
  tab,
  assets: assets.filter(asset => asset.libraryTabId === tab.id),
  cursor: 0
}));

export const createBalancedInsertionSequence = (tabs: LibraryTab[], assets: MediaAsset[]): MediaAsset[] => {
  const queues = queuesByTab(tabs, assets).filter(queue => queue.assets.length > 0);
  const result: MediaAsset[] = [];
  let previous = -1;
  while (result.length < assets.length) {
    const candidates = queues.map((queue, index) => ({ queue, index,
      score: (queue.cursor + 1) / queue.assets.length }))
      .filter(candidate => candidate.queue.cursor < candidate.queue.assets.length)
      .sort((left, right) => {
        const scoreDifference = left.score - right.score;
        if (Math.abs(scoreDifference) > 1e-12) return scoreDifference;
        const leftRepeated = left.index === previous ? 1 : 0;
        const rightRepeated = right.index === previous ? 1 : 0;
        if (leftRepeated !== rightRepeated) return leftRepeated - rightRepeated;
        const sizeDifference = right.queue.assets.length - left.queue.assets.length;
        return sizeDifference || left.index - right.index;
      });
    const selected = candidates[0];
    if (!selected) break;
    result.push(selected.queue.assets[selected.queue.cursor++]);
    previous = selected.index;
  }
  return result;
};

export const parseInsertionPattern = (pattern: string, tabCount: number): number[] => pattern
  .split(/[^0-9]+/)
  .map(value => Number(value) - 1)
  .filter(index => Number.isInteger(index) && index >= 0 && index < tabCount);

export const createInsertionSequence = (
  tabs: LibraryTab[],
  assets: MediaAsset[],
  activeTabId: string,
  config: InsertionConfig,
  seed: number
): MediaAsset[] => {
  const queues = queuesByTab(tabs, assets);
  if (config.mode === 'balanced') return createBalancedInsertionSequence(tabs, assets);
  if (config.mode === 'active') return assets.filter(asset => asset.libraryTabId === activeTabId);
  if (config.mode === 'all') return queues.flatMap(queue => queue.assets);
  if (config.mode === 'random') return shuffleWithSeed(assets, seed);

  const order = config.mode === 'roundRobin'
    ? queues.map((_, index) => index)
    : parseInsertionPattern(config.customPattern, queues.length);
  if (order.length === 0) return queues.flatMap(queue => queue.assets);

  const result: MediaAsset[] = [];
  while (queues.some(queue => queue.cursor < queue.assets.length)) {
    let inserted = false;
    for (const queueIndex of order) {
      const queue = queues[queueIndex];
      const asset = queue?.assets[queue.cursor];
      if (!asset) continue;
      result.push(asset);
      queue.cursor += 1;
      inserted = true;
    }
    if (!inserted) {
      const remaining = queues.find(queue => queue.cursor < queue.assets.length);
      if (!remaining) break;
      result.push(remaining.assets[remaining.cursor++]);
    }
  }
  return result;
};
