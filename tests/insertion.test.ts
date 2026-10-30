import { describe, expect, it } from 'vitest';
import { createInsertionSequence, parseInsertionPattern } from '../src/lib/insertion';
import type { InsertionConfig, LibraryTab, MediaAsset } from '../src/types';

const tabs: LibraryTab[] = [1, 2, 3].map(index => ({
  id: `t${index}`, kind: 'voice', name: `Voice ${index}`, color: '#fff', localAutomationEnabled: false
}));
const assets = ['1a', '1b', '2a', '2b', '3a'].map(name => ({
  id: name, name, kind: 'voice', libraryTabId: `t${name[0]}`, durationMs: 1_000,
  sizeBytes: 1, path: name, previewUrl: name, color: '#fff'
} satisfies MediaAsset));
const config = (mode: InsertionConfig['mode'], customPattern = ''): InsertionConfig => ({ mode, customPattern });

describe('library insertion logic', () => {
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
});
