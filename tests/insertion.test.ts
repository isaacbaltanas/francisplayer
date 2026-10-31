import { describe, expect, it } from 'vitest';
import { createBalancedInsertionSequence, createInsertionSequence, parseInsertionPattern } from '../src/lib/insertion';
import type { InsertionConfig, LibraryTab, MediaAsset } from '../src/types';

const tabs: LibraryTab[] = [1, 2, 3].map(index => ({
  id: `t${index}`, kind: 'voice', name: `Voice ${index}`, color: '#fff', localAutomationEnabled: false, automationPoints: []
}));
const assets = ['1a', '1b', '2a', '2b', '3a'].map(name => ({
  id: name, name, kind: 'voice', libraryTabId: `t${name[0]}`, durationMs: 1_000,
  sizeBytes: 1, path: name, previewUrl: name, color: '#fff', waveform: []
} satisfies MediaAsset));
const config = (mode: InsertionConfig['mode'], customPattern = ''): InsertionConfig => ({ mode, customPattern });

describe('library insertion logic', () => {
  const proportionalAssets = (counts: number[]) => counts.flatMap((count, tabIndex) => Array.from({ length: count }, (_, itemIndex) => ({
    id: `${tabIndex + 1}-${itemIndex + 1}`, name: `${tabIndex + 1}-${itemIndex + 1}`, kind: 'voice' as const,
    libraryTabId: `t${tabIndex + 1}`, durationMs: 1_000, sizeBytes: 1, path: `${tabIndex}-${itemIndex}`,
    previewUrl: `${tabIndex}-${itemIndex}`, color: '#fff', waveform: []
  } satisfies MediaAsset)));

  it('parses human one-based custom patterns', () => {
    expect(parseInsertionPattern('1, 2, 1, 3', 3)).toEqual([0, 1, 0, 2]);
  });

  it('alternates tabs until all queues are empty', () => {
    expect(createInsertionSequence(tabs, assets, 't1', config('roundRobin'), 1).map(item => item.id))
      .toEqual(['1a', '2a', '3a', '1b', '2b']);
  });

  it('supports a custom repeated tab pattern without losing files', () => {
    expect(createInsertionSequence(tabs, assets, 't1', config('custom', '1,2,1,3'), 1).map(item => item.id))
      .toEqual(['1a', '2a', '1b', '3a', '2b']);
  });

  it('distributes 60, 30 and 30 voices as 1, 2, 1, 3 proportionally', () => {
    const sequence = createBalancedInsertionSequence(tabs, proportionalAssets([60, 30, 30]));
    expect(sequence.slice(0, 16).map(item => item.libraryTabId)).toEqual([
      't1', 't2', 't1', 't3', 't1', 't2', 't1', 't3',
      't1', 't2', 't1', 't3', 't1', 't2', 't1', 't3'
    ]);
    expect(new Set(sequence.map(item => item.id)).size).toBe(120);
  });

  it('keeps unequal 40, 30 and 15 voice groups evenly spread without losing a spot', () => {
    const source = proportionalAssets([40, 30, 15]);
    const sequence = createInsertionSequence(tabs, source, 't1', config('balanced'), 1);
    expect(sequence).toHaveLength(85);
    expect(new Set(sequence.map(item => item.id)).size).toBe(85);
    expect(sequence.filter(item => item.libraryTabId === 't1')).toHaveLength(40);
    expect(sequence.filter(item => item.libraryTabId === 't2')).toHaveLength(30);
    expect(sequence.filter(item => item.libraryTabId === 't3')).toHaveLength(15);
    for (const tab of tabs) {
      const positions = sequence.map((item, index) => item.libraryTabId === tab.id ? index : -1).filter(index => index >= 0);
      const idealGap = sequence.length / positions.length;
      const largestGap = Math.max(...positions.slice(1).map((position, index) => position - positions[index]));
      expect(largestGap).toBeLessThanOrEqual(Math.ceil(idealGap) + 1);
    }
  });
});
