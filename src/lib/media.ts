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

const readWaveform = async (file: File, bins = 120): Promise<number[]> => {
  try {
    const context = new AudioContext();
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const channel = buffer.getChannelData(0);
    const size = Math.max(1, Math.floor(channel.length / bins));
    const waveform = Array.from({ length: bins }, (_, bin) => {
      let peak = 0;
      const end = Math.min(channel.length, (bin + 1) * size);
      for (let index = bin * size; index < end; index += 1) peak = Math.max(peak, Math.abs(channel[index]));
      return Math.max(.025, Math.min(1, peak));
    });
    await context.close();
    return waveform;
  } catch {
    return [];
  }
};

export const filesToAssets = async (files: File[], kind: MediaKind, libraryTabId: string): Promise<MediaAsset[]> => {
  return Promise.all(files.map(async (file, index) => {
    const previewUrl = URL.createObjectURL(file);
    try {
      const durationMs = await readDuration(previewUrl);
      const waveform = await readWaveform(file);
      return {
        id: `${kind}-${Date.now()}-${index}-${crypto.randomUUID()}`,
        kind,
        name: file.name.replace(/\.[^/.]+$/, ''),
        durationMs,
        sizeBytes: file.size,
        path: window.francisDesktop?.getPathForFile(file) ?? file.name,
        previewUrl,
        color: colorForAsset(file.name),
        libraryTabId,
        waveform
      };
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      throw error;
    }
  }));
};
