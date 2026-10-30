import { contextBridge, webUtils } from 'electron';

contextBridge.exposeInMainWorld('francisDesktop', {
  platform: process.platform,
  getPathForFile: (file: File) => webUtils.getPathForFile(file)
});
