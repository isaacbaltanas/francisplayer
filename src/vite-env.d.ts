/// <reference types="vite/client" />

interface Window {
  francisDesktop?: {
    platform: string;
    getPathForFile: (file: File) => string;
  };
}
