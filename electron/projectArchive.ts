import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';

export const safeProjectName = (value: string) => value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'Untitled';

export const writeProjectArchive = (payload: any, projectPath: string) => {
  const zip = new AdmZip();
  const manifestAssets: any[] = [];
  for (const [index, asset] of payload.assets.entries()) {
    if (!asset.path || !fs.existsSync(asset.path)) throw new Error(`Missing audio source: ${asset.name}`);
    const tab = payload.libraryTabs.find((item: any) => item.id === asset.libraryTabId);
    const root = asset.kind === 'music' ? 'Music' : 'Voice';
    const extension = path.extname(asset.path) || '.audio';
    const relativePath = `${root}/${safeProjectName(tab?.name || 'List 1')}/${String(index + 1).padStart(3, '0')} - ${safeProjectName(asset.name)}${extension}`;
    zip.addLocalFile(asset.path, path.posix.dirname(relativePath), path.posix.basename(relativePath));
    const { previewUrl: _previewUrl, path: _path, ...portableAsset } = asset;
    manifestAssets.push({ ...portableAsset, relativePath });
  }
  const manifestQuarantine: any[] = [];
  for (const [index, item] of (payload.quarantine || []).entries()) {
    if (!item.path || !fs.existsSync(item.path)) continue;
    const extension = path.extname(item.path) || '.file';
    const relativePath = `Quarantine/${safeProjectName(item.reason || 'unknown')}/${String(index + 1).padStart(3, '0')} - ${safeProjectName(path.basename(item.name, path.extname(item.name)))}${extension}`;
    zip.addLocalFile(item.path, path.posix.dirname(relativePath), path.posix.basename(relativePath));
    const { previewUrl: _previewUrl, path: _path, ...portableItem } = item;
    manifestQuarantine.push({ ...portableItem, relativePath });
  }
  const manifest = { ...payload, format: 'francis-player-project', formatVersion: 1, assets: manifestAssets, quarantine: manifestQuarantine,
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
  for (const item of [...manifest.assets, ...(manifest.quarantine || [])]) {
    const entry = zip.getEntry(item.relativePath);
    if (!entry) throw new Error(`Missing project asset: ${item.relativePath}`);
    const destination = path.resolve(extractRoot, ...item.relativePath.split('/'));
    if (!destination.startsWith(`${path.resolve(extractRoot)}${path.sep}`)) throw new Error('Unsafe project asset path');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, entry.getData());
    item.path = destination;
    item.previewUrl = pathToFileURL(destination).href;
    delete item.relativePath;
  }
  return manifest;
};
