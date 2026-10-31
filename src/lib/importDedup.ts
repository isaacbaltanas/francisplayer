import type { MediaAsset, QuarantineItem } from '../types';

export const duplicateReferencesForTab = (assets: MediaAsset[], quarantine: QuarantineItem[], tabId: string) => {
  const scoped = assets.filter(asset => asset.libraryTabId === tabId);
  const candidates = [...scoped, ...quarantine];
  return {
    knownFingerprints: candidates.map(item => item.fingerprint).filter((value): value is string => Boolean(value)),
    knownFiles: candidates.filter(item => !item.fingerprint).map(item => ({ path: item.path, sizeBytes: item.sizeBytes }))
  };
};

export const filterNewFilesForTab = <T extends { name: string; size: number }>(files: T[], assets: MediaAsset[], tabId: string) => {
  const known = new Set(assets.filter(asset => asset.libraryTabId === tabId).map(asset => `${asset.path}:${asset.sizeBytes}`));
  return files.filter(file => {
    const key = `${file.name}:${file.size}`;
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
};
