import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { readProjectArchive, writeProjectArchive } from '../electron/projectArchive';

const temporaryDirectories: string[] = [];
const temporaryDirectory = () => {
  const result = fs.mkdtempSync(path.join(os.tmpdir(), 'francis-test-'));
  temporaryDirectories.push(result);
  return result;
};

afterEach(() => temporaryDirectories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true })));

describe('.francis project archives', () => {
  it('preserves audio and human-readable configuration folders', () => {
    const root = temporaryDirectory();
    const audioPath = path.join(root, 'voice.wav');
    fs.writeFileSync(audioPath, Buffer.from('RIFF test audio'));
    const rejectedPath = path.join(root, 'damaged.wav');
    fs.writeFileSync(rejectedPath, Buffer.from('damaged but preserved'));
    const projectPath = path.join(root, 'portable.francis');
    const payload = {
      name: 'Portable', settings: { targetDurationMs: 1_000 }, audioSettings: {}, editingPreferences: {},
      musicInsertion: {}, voiceInsertion: {}, arrangement: null, automation: null,
      libraryTabs: [{ id: 'voice-1', name: 'Voz principal' }],
      assets: [{ id: 'a', name: 'Mensaje', kind: 'voice', path: audioPath, previewUrl: 'blob:test', libraryTabId: 'voice-1' }],
      quarantine: [{ id: 'q', name: 'damaged.wav', kind: 'voice', path: rejectedPath, previewUrl: 'blob:q', reason: 'corrupt' }]
    };
    writeProjectArchive(payload, projectPath);

    const entries = new AdmZip(projectPath).getEntries().map(entry => entry.entryName);
    expect(entries).toContain('Configuration/project.json');
    expect(entries).toContain('Configuration/arrangement.json');
    expect(entries.some(entry => entry.startsWith('Voice/Voz principal/'))).toBe(true);
    expect(entries.some(entry => entry.startsWith('Quarantine/corrupt/'))).toBe(true);

    const restored = readProjectArchive(projectPath);
    expect(restored.name).toBe('Portable');
    expect(fs.readFileSync(restored.assets[0].path, 'utf8')).toBe('RIFF test audio');
    expect(restored.assets[0].previewUrl).toMatch(/^francis-media:/);
    expect(fs.readFileSync(restored.quarantine[0].path, 'utf8')).toBe('damaged but preserved');
  });

  it('keeps undo history portable while embedding each audio source only once', () => {
    const root = temporaryDirectory();
    const audioPath = path.join(root, 'music.wav');
    fs.writeFileSync(audioPath, Buffer.from('one shared audio source'));
    const projectPath = path.join(root, 'history.francis');
    const asset = { id: 'song-a', name: 'Song', kind: 'music', path: audioPath, previewUrl: 'blob:old',
      libraryTabId: 'music-1', waveform: [0.1, 0.2] };
    const base = { name: 'History', version: 'test', settings: {}, audioSettings: {}, editingPreferences: {},
      libraryTabs: [{ id: 'music-1', name: 'Music' }], activeMusicTabId: 'music-1', activeVoiceTabId: 'voice-1',
      musicInsertion: {}, voiceInsertion: {}, arrangement: null, automation: null, quarantine: [], importLogs: [] };
    writeProjectArchive({ ...base, assets: [], history: { index: 1, entries: [
      { ...base, assets: [asset] }, { ...base, assets: [] }
    ] } }, projectPath);

    const audioEntries = new AdmZip(projectPath).getEntries().filter(entry => entry.entryName.startsWith('Music/'));
    expect(audioEntries).toHaveLength(1);
    const restored = readProjectArchive(projectPath);
    expect(restored.assets).toHaveLength(0);
    expect(restored.history.index).toBe(1);
    expect(restored.history.entries[0].assets[0].previewUrl).toMatch(/^francis-media:/);
    expect(fs.readFileSync(restored.history.entries[0].assets[0].path, 'utf8')).toBe('one shared audio source');
  });
});
