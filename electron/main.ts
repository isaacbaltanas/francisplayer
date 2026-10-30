import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { readProjectArchive, safeProjectName, writeProjectArchive } from './projectArchive.js';

let mainWindow: BrowserWindow | null = null;
let pendingProjectPath: string | null = null;

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
