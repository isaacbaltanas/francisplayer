import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExportSettings } from '../types';

const defaults: ExportSettings = {
  format: 'wav', channels: 2, sampleRate: 48000, bitDepth: 24,
  bitrate: 256, compressionLevel: 5, normalize: false
};

export function ExportDialog({ open, canExport, onClose, onExport }: {
  open: boolean;
  canExport: boolean;
  onClose: () => void;
  onExport: (settings: ExportSettings) => Promise<string | null>;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(defaults);
  const [progress, setProgress] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => window.francisDesktop?.onExportProgress(setProgress), []);
  if (!open) return null;
  const lossy = ['mp3', 'aac', 'ogg', 'opus'].includes(settings.format);
  const patch = (next: Partial<ExportSettings>) => setSettings(current => ({ ...current, ...next }));

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !exporting) onClose(); }}>
    <section className="export-dialog" role="dialog" aria-modal="true" aria-label={t('exportMix')}>
      <header><div><span>{t('exportAudio')}</span><h2>{t('exportMix')}</h2></div><button onClick={onClose} disabled={exporting}>×</button></header>
      <div className="export-grid">
        <label><span>{t('exportFormat')}</span><select value={settings.format} onChange={event => patch({ format: event.target.value as ExportSettings['format'] })}>
          <option value="wav">WAV</option><option value="mp3">MP3</option><option value="aac">AAC / M4A</option>
          <option value="flac">FLAC</option><option value="ogg">OGG Vorbis</option><option value="opus">Opus</option>
        </select></label>
        <label><span>{t('channels')}</span><select value={settings.channels} onChange={event => patch({ channels: Number(event.target.value) as 1 | 2 })}>
          <option value="2">{t('stereo')}</option><option value="1">{t('mono')}</option>
        </select></label>
        <label><span>{t('sampleRate')}</span><select value={settings.sampleRate} onChange={event => patch({ sampleRate: Number(event.target.value) as ExportSettings['sampleRate'] })}>
          <option value="44100">44.1 kHz</option><option value="48000">48 kHz</option><option value="96000">96 kHz</option>
        </select></label>
        {!lossy && <label><span>{t('bitDepth')}</span><select value={settings.bitDepth} onChange={event => patch({ bitDepth: Number(event.target.value) as ExportSettings['bitDepth'] })}>
          <option value="16">16 bit</option><option value="24">24 bit</option><option value="32">32 bit / float</option>
        </select></label>}
        {lossy && <label><span>{t('bitrate')}</span><select value={settings.bitrate} onChange={event => patch({ bitrate: Number(event.target.value) as ExportSettings['bitrate'] })}>
          <option value="96">96 kbps</option><option value="128">128 kbps</option><option value="192">192 kbps</option>
          <option value="256">256 kbps</option><option value="320">320 kbps</option>
        </select></label>}
        {settings.format === 'flac' && <label><span>{t('compression')}</span><input type="range" min="0" max="12" value={settings.compressionLevel}
          onChange={event => patch({ compressionLevel: Number(event.target.value) })} /><output>{settings.compressionLevel}</output></label>}
        <label className="export-check"><input type="checkbox" checked={settings.normalize} onChange={event => patch({ normalize: event.target.checked })} />
          <span>{t('normalizeLoudness')}</span></label>
      </div>
      <div className="export-summary">{settings.format.toUpperCase()} · {settings.channels === 2 ? t('stereo') : t('mono')} · {settings.sampleRate / 1000} kHz · {lossy ? `${settings.bitrate} kbps` : `${settings.bitDepth} bit`}</div>
      {(exporting || progress > 0) && <div className="export-progress"><i style={{ width: `${progress}%` }} /><span>{Math.round(progress)}%</span></div>}
      {result && <p className="export-result">✓ {t('exportComplete')}<small>{result}</small></p>}
      {failed && <p className="export-error">! {t('exportFailed')}</p>}
      <footer>
        {exporting ? <button className="secondary" onClick={() => void window.francisDesktop?.cancelExport()}>{t('cancelExport')}</button>
          : <button className="secondary" onClick={onClose}>{t('close')}</button>}
        <button className="export-primary" disabled={!canExport || exporting} onClick={async () => {
          setExporting(true); setProgress(0); setResult(null); setFailed(false);
          try { const output = await onExport(settings); setResult(output); }
          catch { setFailed(true); }
          finally { setExporting(false); }
        }}>{exporting ? t('exporting') : t('startExport')}</button>
      </footer>
    </section>
  </div>;
}
