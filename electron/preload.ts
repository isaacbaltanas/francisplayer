import { contextBridge, ipcRenderer, webUtils } from 'electron';

let pendingProjectPath: string | null = null;
const openCallbacks = new Set<(projectPath: string) => void>();
type MenuCommand = 'new' | 'open' | 'save' | 'saveAs' | 'quarantine' | 'importLog' | 'export';
const menuCallbacks = new Set<(command: MenuCommand) => void>();
ipcRenderer.on('project:open-requested', (_event, projectPath: string) => {
  if (openCallbacks.size === 0) pendingProjectPath = projectPath;
  openCallbacks.forEach(callback => callback(projectPath));
});
ipcRenderer.on('menu:command', (_event, command: MenuCommand) => {
  menuCallbacks.forEach(callback => callback(command));
});

contextBridge.exposeInMainWorld('francisDesktop', {
  platform: process.platform,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  saveProject: (payload: unknown, projectPath?: string) => ipcRenderer.invoke('project:save', payload, projectPath),
  openProject: (projectPath?: string) => ipcRenderer.invoke('project:open', projectPath),
  onOpenProject: (callback: (projectPath: string) => void) => {
    openCallbacks.add(callback);
    if (pendingProjectPath) { const next = pendingProjectPath; pendingProjectPath = null; queueMicrotask(() => callback(next)); }
    return () => { openCallbacks.delete(callback); };
  },
  onMenuCommand: (callback: (command: MenuCommand) => void) => {
    menuCallbacks.add(callback);
    return () => { menuCallbacks.delete(callback); };
  },
  exportAudio: (payload: unknown, options: unknown) => ipcRenderer.invoke('audio:export', payload, options),
  cancelExport: () => ipcRenderer.invoke('audio:cancel-export'),
  onExportProgress: (callback: (progress: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: number) => callback(progress);
    ipcRenderer.on('audio:export-progress', listener);
    return () => ipcRenderer.removeListener('audio:export-progress', listener);
  },
  importPaths: (request: unknown) => ipcRenderer.invoke('media:import-paths', request),
  generateWaveforms: (filePaths: string[]) => ipcRenderer.invoke('media:generate-waveforms', filePaths),
  onImportProgress: (callback: (progress: { completed: number; total: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { completed: number; total: number }) => callback(progress);
    ipcRenderer.on('media:import-progress', listener);
    return () => ipcRenderer.removeListener('media:import-progress', listener);
  }
});
