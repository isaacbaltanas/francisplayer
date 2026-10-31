/// <reference types="vite/client" />

interface Window {
  francisDesktop?: {
    platform: string;
    getPathForFile: (file: File) => string;
    saveProject: (payload: unknown, projectPath?: string) => Promise<string | null>;
    openProject: (projectPath?: string) => Promise<{ projectPath: string; project: any } | null>;
    confirmUnsavedChanges: (language: string) => Promise<'save' | 'discard' | 'cancel'>;
    onOpenProject: (callback: (projectPath: string) => void) => () => void;
    onMenuCommand: (callback: (command: 'new' | 'open' | 'save' | 'saveAs' | 'quarantine' | 'importLog' | 'export' | 'undo' | 'redo') => void) => () => void;
    exportAudio: (payload: unknown, options: unknown) => Promise<string | null>;
    cancelExport: () => Promise<boolean>;
    onExportProgress: (callback: (progress: number) => void) => () => void;
    importPaths: (request: unknown) => Promise<any>;
    generateWaveforms: (filePaths: string[]) => Promise<Array<{ path: string; waveform: number[] }>>;
    preparePreviews: (filePaths: string[]) => Promise<string[]>;
    onImportProgress: (callback: (progress: { jobId?: string; kind?: 'music' | 'voice'; completed: number; total: number }) => void) => () => void;
  };
}
