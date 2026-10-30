import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { readProjectArchive, safeProjectName, writeProjectArchive } from './projectArchive.js';
import { buildExportPlan, codecArguments, collectProcessResult, parseProgress } from './exportAudio.js';

let mainWindow: BrowserWindow | null = null;
let pendingProjectPath: string | null = null;
let exportProcess: ChildProcess | null = null;

const saveProject = async (payload: any, requestedPath?: string) => {
  let projectPath = requestedPath;
  if (!projectPath) {
    const result = await dialog.showSaveDialog({
      title: 'Guardar proyecto Francis Player', defaultPath: `${safeProjectName(payload.name || 'Proyecto')}.francis`,
      filters: [{ name: 'Francis Player Project', extensions: ['francis'] }]
    });
    if (result.canceled || !result.filePath) return null;
    projectPath = result.filePath.endsWith('.francis') ? result.filePath : `${result.filePath}.francis`;
  }

  writeProjectArchive(payload, projectPath);
  return projectPath;
};

const openProject = async (requestedPath?: string) => {
  let projectPath = requestedPath;
  if (!projectPath) {
    const result = await dialog.showOpenDialog({ title: 'Abrir proyecto Francis Player', properties: ['openFile'],
      filters: [{ name: 'Francis Player Project', extensions: ['francis'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    projectPath = result.filePaths[0];
  }
  return { projectPath, project: readProjectArchive(projectPath) };
};

const createWindow = async () => {
  const window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#111315',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;

  window.once('ready-to-show', () => {
    window.maximize();
    window.show();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) {
    await window.loadURL(devServer);
  } else {
    await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  if (pendingProjectPath) {
    window.webContents.send('project:open-requested', pendingProjectPath);
    pendingProjectPath = null;
  }
};

ipcMain.handle('project:save', (_event, payload, requestedPath?: string) => saveProject(payload, requestedPath));
ipcMain.handle('project:open', (_event, requestedPath?: string) => openProject(requestedPath));
ipcMain.handle('audio:export', async (event, payload: any, options: any) => {
  const extensions: Record<string, string> = { wav: 'wav', mp3: 'mp3', aac: 'm4a', flac: 'flac', ogg: 'ogg', opus: 'opus' };
  const extension = extensions[options.format] ?? 'wav';
  const result = await dialog.showSaveDialog({
    title: 'Exportar mezcla', defaultPath: `${safeProjectName(payload.name || 'Francis Player')}.${extension}`,
    filters: [{ name: `${options.format.toUpperCase()} Audio`, extensions: [extension] }]
  });
  if (result.canceled || !result.filePath) return null;
  if (!ffmpegStatic) throw new Error('FFmpeg binary is unavailable');
  const outputPath = result.filePath.toLowerCase().endsWith(`.${extension}`) ? result.filePath : `${result.filePath}.${extension}`;
  const plan = buildExportPlan({ ...payload, exportOptions: options });
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'francis-export-'));
  const filterPath = path.join(temporaryDirectory, 'mix.ffmpeg');
  fs.writeFileSync(filterPath, plan.filterScript);
  const binary = app.isPackaged ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : ffmpegStatic;
  const args = [...plan.inputs, '-filter_complex_script', filterPath, '-map', '[out]', '-ac', String(options.channels),
    '-ar', String(options.sampleRate), ...codecArguments(options), '-map_metadata', '-1', '-y', outputPath];
  exportProcess = spawn(binary, args, { windowsHide: true });
  let stderr = '';
  exportProcess.stderr?.on('data', chunk => {
    stderr += chunk.toString();
    const lines = stderr.split(/[\r\n]+/);
    stderr = lines.pop() ?? '';
    lines.forEach(line => {
      const progress = parseProgress(line, payload.arrangement.durationMs);
      if (progress !== null) event.sender.send('audio:export-progress', progress);
    });
  });
  try {
    await collectProcessResult(exportProcess);
    event.sender.send('audio:export-progress', 100);
    return outputPath;
  } finally {
    exportProcess = null;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
ipcMain.handle('audio:cancel-export', () => {
  if (!exportProcess) return false;
  exportProcess.kill('SIGTERM');
  return true;
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) mainWindow.webContents.send('project:open-requested', filePath);
  else pendingProjectPath = filePath;
});

app.whenReady().then(async () => {
  const argumentProject = process.argv.find(argument => argument.toLowerCase().endsWith('.francis'));
  if (argumentProject) pendingProjectPath = argumentProject;
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
