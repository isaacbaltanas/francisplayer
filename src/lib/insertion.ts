import { shuffleWithSeed } from './arrangement';
import type { InsertionConfig, LibraryTab, MediaAsset } from '../types';

const queuesByTab = (tabs: LibraryTab[], assets: MediaAsset[]) => tabs.map(tab => ({
  tab,
  assets: assets.filter(asset => asset.libraryTabId === tab.id),
  cursor: 0
}));

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
