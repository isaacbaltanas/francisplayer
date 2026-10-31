export const mediaUrlForPath = (filePath: string) => `francis-media://local/audio?path=${encodeURIComponent(filePath)}`;

export const requiresPreviewProxy = (filePath: string) => /\.(aif|aiff|wma)$/i.test(filePath);
