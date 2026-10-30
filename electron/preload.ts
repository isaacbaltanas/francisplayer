import { contextBridge, ipcRenderer, webUtils } from 'electron';

let pendingProjectPath: string | null = null;
const openCallbacks = new Set<(projectPath: string) => void>();
ipcRenderer.on('project:open-requested', (_event, projectPath: string) => {
  if (openCallbacks.size === 0) pendingProjectPath = projectPath;
  openCallbacks.forEach(callback => callback(projectPath));
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
  }
});
