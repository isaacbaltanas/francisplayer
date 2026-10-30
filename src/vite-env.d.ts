/// <reference types="vite/client" />

interface Window {
  francisDesktop?: {
    platform: string;
    getPathForFile: (file: File) => string;
    saveProject: (payload: unknown, projectPath?: string) => Promise<string | null>;
    openProject: (projectPath?: string) => Promise<{ projectPath: string; project: any } | null>;
    onOpenProject: (callback: (projectPath: string) => void) => () => void;
  };
}
