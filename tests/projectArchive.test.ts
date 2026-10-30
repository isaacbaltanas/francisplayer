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
    expect(restored.assets[0].previewUrl).toMatch(/^file:/);
    expect(fs.readFileSync(restored.quarantine[0].path, 'utf8')).toBe('damaged but preserved');
  });
});
