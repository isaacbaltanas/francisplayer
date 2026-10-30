/// <reference types="vite/client" />

interface Window {
  francisDesktop?: {
    platform: string;
    getPathForFile: (file: File) => string;
    saveProject: (payload: unknown, projectPath?: string) => Promise<string | null>;
    openProject: (projectPath?: string) => Promise<{ projectPath: string; project: any } | null>;
    onOpenProject: (callback: (projectPath: string) => void) => () => void;
    exportAudio: (payload: unknown, options: unknown) => Promise<string | null>;
    cancelExport: () => Promise<boolean>;
    onExportProgress: (callback: (progress: number) => void) => () => void;
    importPaths: (request: unknown) => Promise<any>;
    onImportProgress: (callback: (progress: { completed: number; total: number }) => void) => () => void;
  };
}
