import { describe, expect, it } from 'vitest';
import { duplicateReferencesForTab, filterNewFilesForTab } from '../src/lib/importDedup';
import type { MediaAsset } from '../src/types';

const asset = (tab: string, fingerprint: string): MediaAsset => ({
  id: `${tab}-${fingerprint}`, kind: 'music', name: fingerprint, durationMs: 1_000, sizeBytes: 100,
  path: `${fingerprint}.wav`, previewUrl: fingerprint, color: '#fff', libraryTabId: tab, waveform: [], fingerprint
});

describe('tab-scoped import deduplication', () => {
  it('blocks fingerprints already present in the destination tab but not in another tab', () => {
    const assets = [asset('music-1', 'same-tab'), asset('music-2', 'other-tab')];
    const references = duplicateReferencesForTab(assets, [], 'music-1');
    expect(references.knownFingerprints).toEqual(['same-tab']);
    expect(references.knownFingerprints).not.toContain('other-tab');
  });

  it('removes repeated browser files only within the destination tab and within the same batch', () => {
    const files = [{ name: 'song.wav', size: 100 }, { name: 'new.wav', size: 200 }, { name: 'new.wav', size: 200 }];
    expect(filterNewFilesForTab(files, [asset('music-1', 'song')], 'music-1').map(file => file.name)).toEqual(['new.wav']);
    expect(filterNewFilesForTab(files, [asset('music-2', 'song')], 'music-1').map(file => file.name)).toEqual(['song.wav', 'new.wav']);
  });
});
