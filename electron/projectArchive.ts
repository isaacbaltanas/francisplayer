import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mediaUrlForPath } from './mediaUrl.js';
import AdmZip from 'adm-zip';

export const safeProjectName = (value: string) => value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'Untitled';

export const writeProjectArchive = (payload: any, projectPath: string) => {
  const zip = new AdmZip();
  const historyAssets = (payload.history?.entries || []).flatMap((entry: any) => entry.assets || []);
  const assetSources = new Map<string, any>();
  [...payload.assets, ...historyAssets].forEach((asset: any) => { if (!assetSources.has(asset.id)) assetSources.set(asset.id, asset); });
  const assetRegistry: any[] = [];
  for (const [index, asset] of [...assetSources.values()].entries()) {
    if (!asset.path || !fs.existsSync(asset.path)) throw new Error(`Missing audio source: ${asset.name}`);
    const tab = payload.libraryTabs.find((item: any) => item.id === asset.libraryTabId);
    const root = asset.kind === 'music' ? 'Music' : 'Voice';
    const extension = path.extname(asset.path) || '.audio';
    const relativePath = `${root}/${safeProjectName(tab?.name || 'List 1')}/${String(index + 1).padStart(3, '0')} - ${safeProjectName(asset.name)}${extension}`;
    zip.addLocalFile(asset.path, path.posix.dirname(relativePath), path.posix.basename(relativePath));
    const { previewUrl: _previewUrl, path: _path, ...portableAsset } = asset;
    assetRegistry.push({ ...portableAsset, relativePath });
  }
  const portableAsset = (asset: any) => {
    const { previewUrl: _previewUrl, path: _path, waveform: _waveform, ...portable } = asset;
    return portable;
  };
  const manifestAssets = payload.assets.map((asset: any) => portableAsset(asset));
  const historyQuarantine = (payload.history?.entries || []).flatMap((entry: any) => entry.quarantine || []);
  const quarantineSources = new Map<string, any>();
  [...(payload.quarantine || []), ...historyQuarantine].forEach((item: any) => {
    if (!quarantineSources.has(item.id)) quarantineSources.set(item.id, item);
  });
  const quarantineRegistry: any[] = [];
  for (const [index, item] of [...quarantineSources.values()].entries()) {
    if (!item.path || !fs.existsSync(item.path)) throw new Error(`Missing quarantined source: ${item.name}`);
    const extension = path.extname(item.path) || '.file';
    const relativePath = `Quarantine/${safeProjectName(item.reason || 'unknown')}/${String(index + 1).padStart(3, '0')} - ${safeProjectName(path.basename(item.name, path.extname(item.name)))}${extension}`;
    zip.addLocalFile(item.path, path.posix.dirname(relativePath), path.posix.basename(relativePath));
    const { previewUrl: _previewUrl, path: _path, ...portableItem } = item;
    quarantineRegistry.push({ ...portableItem, relativePath });
  }
  const portableQuarantine = (item: any) => {
    const { previewUrl: _previewUrl, path: _path, ...portable } = item;
    return portable;
  };
  const manifestQuarantine = (payload.quarantine || []).map(portableQuarantine);
  const manifestHistory = payload.history ? { ...payload.history, entries: payload.history.entries.map((entry: any) => ({
    ...entry, assets: (entry.assets || []).map(portableAsset),
    quarantine: (entry.quarantine || []).map(portableQuarantine)
  })) } : undefined;
  const manifest = { ...payload, format: 'francis-player-project', formatVersion: 1, assets: manifestAssets, assetRegistry,
    history: manifestHistory, quarantine: manifestQuarantine, quarantineRegistry,
    savedAt: new Date().toISOString() };
  zip.addFile('project.json', Buffer.from(JSON.stringify({ format: manifest.format, formatVersion: 1, name: payload.name, savedAt: manifest.savedAt }, null, 2)));
  zip.addFile('Configuration/project.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.addFile('Configuration/arrangement.json', Buffer.from(JSON.stringify(payload.arrangement, null, 2)));
  zip.addFile('Configuration/automation.json', Buffer.from(JSON.stringify(payload.automation, null, 2)));
  zip.addFile('Configuration/settings.json', Buffer.from(JSON.stringify({ settings: payload.settings, audioSettings: payload.audioSettings,
    editingPreferences: payload.editingPreferences, musicInsertion: payload.musicInsertion, voiceInsertion: payload.voiceInsertion }, null, 2)));
  zip.writeZip(projectPath);
};

export const readProjectArchive = (projectPath: string) => {
  const zip = new AdmZip(projectPath);
  const manifestEntry = zip.getEntry('Configuration/project.json');
  if (!manifestEntry) throw new Error('Invalid Francis Player project');
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  if (manifest.format !== 'francis-player-project' || manifest.formatVersion !== 1) throw new Error('Unsupported Francis Player project');
  const extractRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'francis-player-'));
  const registry = manifest.assetRegistry || manifest.assets;
  const quarantineRegistry = manifest.quarantineRegistry || manifest.quarantine || [];
  const hydratedAssets = new Map<string, any>();
  const hydratedQuarantine = new Map<string, any>();
  for (const item of [...registry, ...quarantineRegistry]) {
    const entry = zip.getEntry(item.relativePath);
    if (!entry) throw new Error(`Missing project asset: ${item.relativePath}`);
    const destination = path.resolve(extractRoot, ...item.relativePath.split('/'));
    if (!destination.startsWith(`${path.resolve(extractRoot)}${path.sep}`)) throw new Error('Unsafe project asset path');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, entry.getData());
    item.path = destination;
    item.previewUrl = mediaUrlForPath(destination);
    delete item.relativePath;
    if (item.id && registry.includes(item)) hydratedAssets.set(item.id, item);
    if (item.id && quarantineRegistry.includes(item)) hydratedQuarantine.set(item.id, item);
  }
  if (manifest.assetRegistry) {
    const hydrate = (item: any) => {
      const source = hydratedAssets.get(item.id);
      if (!source) throw new Error(`Missing project asset registry entry: ${item.id}`);
      return { ...source, ...item, path: source.path, previewUrl: source.previewUrl, waveform: source.waveform ?? [] };
    };
    manifest.assets = manifest.assets.map(hydrate);
    if (manifest.history?.entries) manifest.history.entries = manifest.history.entries.map((snapshot: any) => ({
      ...snapshot, assets: (snapshot.assets || []).map(hydrate)
    }));
    delete manifest.assetRegistry;
  }
  if (manifest.quarantineRegistry) {
    const hydrate = (item: any) => {
      const source = hydratedQuarantine.get(item.id);
      if (!source) throw new Error(`Missing quarantine registry entry: ${item.id}`);
      return { ...source, ...item, path: source.path, previewUrl: source.previewUrl };
    };
    manifest.quarantine = manifest.quarantine.map(hydrate);
    if (manifest.history?.entries) manifest.history.entries = manifest.history.entries.map((snapshot: any) => ({
      ...snapshot, quarantine: (snapshot.quarantine || []).map(hydrate)
    }));
    delete manifest.quarantineRegistry;
  }
  return manifest;
};
