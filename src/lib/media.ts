import type { MediaAsset, MediaKind } from '../types';

const palette = [
  '#4f8cff', '#7c6cf2', '#de6ea8', '#e77d50', '#d4a63d',
  '#4eb6a1', '#42a6cc', '#7b94d8', '#9b72cf', '#d66c78'
];

const hash = (value: string) => {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  }
  return Math.abs(result);
};

export const colorForAsset = (name: string) => palette[hash(name) % palette.length];

const readDuration = (url: string) => new Promise<number>((resolve, reject) => {
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  audio.onloadedmetadata = () => {
    const duration = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0;
    resolve(duration);
  };
  audio.onerror = () => reject(new Error('Unable to read audio metadata'));
  audio.src = url;
});

export const filesToAssets = async (files: File[], kind: MediaKind, libraryTabId: string): Promise<MediaAsset[]> => {
  return Promise.all(files.map(async (file, index) => {
    const previewUrl = URL.createObjectURL(file);
    try {
      const durationMs = await readDuration(previewUrl);
      return {
        id: `${kind}-${Date.now()}-${index}-${crypto.randomUUID()}`,
        kind,
        name: file.name.replace(/\.[^/.]+$/, ''),
        durationMs,
        sizeBytes: file.size,
        path: window.francisDesktop?.getPathForFile(file) ?? file.name,
        previewUrl,
        color: colorForAsset(file.name),
        libraryTabId
      };
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      throw error;
    }
  }));
};
