import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, shell, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import ffmpegStatic from 'ffmpeg-static';
import { readProjectArchive, safeProjectName } from './projectArchive.js';
import { buildExportPlan, codecArguments, collectProcessResult, parseProgress } from './exportAudio.js';
import { generateWaveforms, scanImportPaths } from './importAudio.js';
import { preparePreviewProxy, registerMediaProtocol } from './mediaProtocol.js';

protocol.registerSchemesAsPrivileged([{ scheme: 'francis-media', privileges: {
  standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true
} }]);

let mainWindow: BrowserWindow | null = null;
let pendingProjectPath: string | null = null;
let exportProcess: ChildProcess | null = null;
const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');

app.setName('Francis Player');
app.setAppUserModelId('com.francisplayer.app');

type MenuCommand = 'new' | 'open' | 'save' | 'saveAs' | 'quarantine' | 'importLog' | 'export' | 'undo' | 'redo';
const sendMenuCommand = (command: MenuCommand) => mainWindow?.webContents.send('menu:command', command);
const installApplicationMenu = () => {
  const fileMenu: MenuItemConstructorOptions = {
    label: 'Archivo',
    submenu: [
      { label: 'Nuevo proyecto', accelerator: 'CmdOrCtrl+N', click: () => sendMenuCommand('new') },
      { label: 'Abrir…', accelerator: 'CmdOrCtrl+O', click: () => sendMenuCommand('open') },
      { type: 'separator' },
      { label: 'Guardar', accelerator: 'CmdOrCtrl+S', click: () => sendMenuCommand('save') },
      { label: 'Guardar como…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenuCommand('saveAs') },
      { type: 'separator' },
      { label: 'Cuarentena…', click: () => sendMenuCommand('quarantine') },
      { label: 'Registro de importación…', click: () => sendMenuCommand('importLog') },
      { type: 'separator' },
      { label: 'Exportar audio…', accelerator: 'CmdOrCtrl+E', click: () => sendMenuCommand('export') },
      { type: 'separator' },
      process.platform === 'darwin' ? { role: 'close', label: 'Cerrar ventana' } : { role: 'quit', label: 'Salir' }
    ]
  };
  const template: MenuItemConstructorOptions[] = [fileMenu,
    { label: 'Edición', submenu: [
      { label: 'Deshacer', accelerator: 'CmdOrCtrl+Z', click: () => sendMenuCommand('undo') },
      { label: 'Rehacer', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendMenuCommand('redo') }, { type: 'separator' },
      { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' }, { role: 'selectAll', label: 'Seleccionar todo' }] },
    { label: 'Visualización', submenu: [{ role: 'reload', label: 'Recargar' }, { role: 'togglefullscreen', label: 'Pantalla completa' }] },
    { label: 'Ventana', submenu: [{ role: 'minimize', label: 'Minimizar' }, { role: 'zoom', label: 'Zoom' }, { role: 'front', label: 'Traer todo al frente' }] }
  ];
  if (process.platform === 'darwin') template.unshift({ label: app.name, submenu: [
    { role: 'about', label: 'Acerca de Francis Player' }, { type: 'separator' },
    { role: 'hide', label: 'Ocultar Francis Player' }, { role: 'hideOthers', label: 'Ocultar las demás' }, { role: 'unhide', label: 'Mostrar todo' },
    { type: 'separator' }, { role: 'quit', label: 'Salir de Francis Player' }
  ] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

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

  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'projectArchiveWorker.js'));
    const finish = () => { void worker.terminate(); };
    worker.once('message', (result: { ok: boolean; error?: string }) => {
      finish();
      if (result.ok) resolve(); else reject(new Error(result.error || 'Project save failed'));
    });
    worker.once('error', error => { finish(); reject(error); });
    worker.postMessage({ payload, projectPath });
  });
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
    icon: nativeImage.createFromPath(iconPath),
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
ipcMain.handle('project:confirm-unsaved', async (_event, language: string) => {
  const english = language?.toLowerCase().startsWith('en');
  const result = await dialog.showMessageBox(mainWindow!, {
    type: 'warning', title: english ? 'Unsaved changes' : 'Cambios sin guardar',
    message: english ? 'Do you want to save the changes to this project?' : '¿Quieres guardar los cambios de este proyecto?',
    detail: english ? 'If you discard the changes, you will not be able to recover them from this project.'
      : 'Si descartas los cambios, no podrás recuperarlos desde este proyecto.',
    buttons: english ? ['Save', 'Discard', 'Cancel'] : ['Guardar', 'Descartar', 'Cancelar'],
    defaultId: 0, cancelId: 2, noLink: true
  });
  return (['save', 'discard', 'cancel'] as const)[result.response] ?? 'cancel';
});
ipcMain.handle('media:import-paths', async (event, request: any) => {
  if (!ffmpegStatic) throw new Error('FFmpeg binary is unavailable');
  const binary = app.isPackaged ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : ffmpegStatic;
  return scanImportPaths({ ...request, ffmpegPath: binary,
    onProgress: (completed: number, total: number) => event.sender.send('media:import-progress', {
      jobId: request.jobId, kind: request.kind, completed, total
    }) });
});
ipcMain.handle('media:generate-waveforms', async (event, filePaths: string[]) => {
  if (!ffmpegStatic) throw new Error('FFmpeg binary is unavailable');
  const binary = app.isPackaged ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : ffmpegStatic;
  return generateWaveforms(binary, filePaths,
    (completed, total) => event.sender.send('media:import-progress', { completed, total }));
});
ipcMain.handle('media:prepare-previews', async (_event, filePaths: string[]) => {
  const binary = ffmpegStatic ? (app.isPackaged ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : ffmpegStatic) : null;
  const paths = [...new Set(filePaths)];
  const results = new Array<string>(paths.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, Math.max(1, paths.length)) }, async () => {
    while (cursor < paths.length) {
      const index = cursor++;
      results[index] = await preparePreviewProxy(paths[index], binary);
    }
  });
  await Promise.all(workers);
  return results;
});
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
  registerMediaProtocol(ffmpegStatic ? (app.isPackaged ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : ffmpegStatic) : null);
  const icon = nativeImage.createFromPath(iconPath);
  if (process.platform === 'darwin' && !icon.isEmpty()) app.dock?.setIcon(icon);
  app.setAboutPanelOptions({
    applicationName: 'Francis Player',
    applicationVersion: app.getVersion(),
    copyright: 'Estudio de montaje automático para megafonías',
    iconPath
  });
  installApplicationMenu();
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
