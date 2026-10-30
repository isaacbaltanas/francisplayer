export const formatDuration = (durationMs: number, includeMs = false) => {
  const safeMs = Math.max(0, durationMs);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const prefix = hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}` : String(minutes);
  const base = `${prefix}:${String(seconds).padStart(2, '0')}`;
  return includeMs ? `${base}.${String(Math.floor(safeMs % 1000)).padStart(3, '0')}` : base;
};

export const formatBytes = (bytes: number, locale: string) => {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`;
};
