import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExportProgress, ExportResult, ExportSettings, ExportSilenceIssue } from '../types';

const defaults: ExportSettings = {
  format: 'wav', channels: 2, sampleRate: 44100, bitDepth: 16,
  bitrate: 256, compressionLevel: 5, normalize: false,
  verifyOutput: true, detectSilence: true, silenceThresholdDb: -40, silenceMinimumMs: 2000
};

const clock = (milliseconds: number) => {
  const total = Math.max(0, milliseconds) / 1000;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`;
};

const eta = (milliseconds: number) => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  return hours ? `${hours} h ${minutes} min` : minutes ? `${minutes} min ${remainder} s` : `${remainder} s`;
};

export function ExportDialog({ open, canExport, silenceDetection, preflightSilences, durationMs, onClose, onExport, onSeek }: {
  open: boolean;
  canExport: boolean;
  silenceDetection: { enabled: boolean; thresholdDb: number; minimumMs: number };
  preflightSilences: ExportSilenceIssue[];
  durationMs: number;
  onClose: () => void;
  onExport: (settings: ExportSettings) => Promise<ExportResult | null>;
  onSeek?: (positionMs: number) => void;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(defaults);
  const [progress, setProgress] = useState<ExportProgress>({ phase: 'preflight', percent: 0 });
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [failed, setFailed] = useState('');

  useEffect(() => window.francisDesktop?.onExportProgress(next => {
    setProgress(typeof next === 'number' ? { phase: 'rendering', percent: next } : next);
  }), []);
  useEffect(() => {
    if (!open) return;
    setSettings(current => ({ ...current, detectSilence: silenceDetection.enabled,
      silenceThresholdDb: silenceDetection.thresholdDb, silenceMinimumMs: silenceDetection.minimumMs }));
  }, [open, silenceDetection.enabled, silenceDetection.thresholdDb, silenceDetection.minimumMs]);
  if (!open) return null;
  const lossy = ['mp3', 'aac', 'ogg', 'opus'].includes(settings.format);
  const patch = (next: Partial<ExportSettings>) => setSettings(current => ({ ...current, ...next }));
  const report = result?.report;

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !exporting) onClose(); }}>
    <section className="export-dialog verified-export-dialog" role="dialog" aria-modal="true" aria-label={t('exportMix')}>
      <header><div><span>{t('exportAudio')}</span><h2>{t('exportMix')}</h2></div><button onClick={onClose} disabled={exporting}>×</button></header>
      <div className="export-body">
        <div className="export-grid">
          <label><span>{t('exportFormat')}</span><select value={settings.format} onChange={event => patch({ format: event.target.value as ExportSettings['format'] })}>
            <option value="wav">WAV / RF64</option><option value="mp3">MP3</option><option value="aac">AAC / M4A</option>
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
          <label className="export-check"><input type="checkbox" checked={settings.verifyOutput} onChange={event => patch({ verifyOutput: event.target.checked })} />
            <span>{t('verifyExport')}</span></label>
        </div>
        <div className="export-summary">{settings.format.toUpperCase()} · {settings.channels === 2 ? t('stereo') : t('mono')} · {settings.sampleRate / 1000} kHz · {lossy ? `${settings.bitrate} kbps` : `${settings.bitDepth} bit`}</div>
        {silenceDetection.enabled && <section className="preexport-silence-check">
          <header><strong>{preflightSilences.length ? `! ${t('silenceWarnings', { count: preflightSilences.length })}` : `✓ ${t('noTimelineSilences')}`}</strong>
            <span>{silenceDetection.thresholdDb} dBFS · {(silenceDetection.minimumMs / 1000).toFixed(1)} s</span></header>
          <div className="orange-silence-timeline" aria-label={t('silenceTimeline')}>
            <span className="timeline-timecode timeline-timecode-start">{clock(0)}</span>
            <i aria-hidden="true" />
            {preflightSilences.map((issue, index) => {
              const position = Math.min(100, Math.max(0, (issue.startMs + issue.durationMs / 2) / Math.max(1, durationMs) * 100));
              return <button key={`${issue.startMs}-${index}`} className={index % 2 ? 'label-below' : 'label-above'}
                style={{ left: `${position}%` }} title={`${clock(issue.startMs)}–${clock(issue.endMs)} · ${clock(issue.durationMs)}`}
                onClick={() => onSeek?.(issue.startMs)}><b /><span>{clock(issue.startMs)}</span></button>;
            })}
            <span className="timeline-timecode timeline-timecode-end">{clock(durationMs)}</span>
          </div>
          {preflightSilences.length > 0 && <>
          <div className="silence-list">{preflightSilences.map((issue, index) => <button key={`${issue.endMs}-${index}`} onClick={() => onSeek?.(issue.startMs)}>
            <time>{clock(issue.startMs)}</time><b>{(issue.durationMs / 1000).toFixed(1)} s</b>
            <span>{issue.beforeClip && issue.afterClip ? `${issue.beforeClip} → ${issue.afterClip}` : issue.beforeClip || issue.afterClip || t('unknownRegion')}</span>
          </button>)}</div></>}
        </section>}
        {(exporting || progress.percent > 0) && <div className="export-progress-block">
          <div className="export-progress"><i style={{ width: `${progress.percent}%` }} /><span>{Math.round(progress.percent)}%</span></div>
          <small>{t(`exportPhase_${progress.phase}`)}{progress.detail ? ` · ${progress.detail}` : ''}
            {progress.etaMs !== undefined && progress.phase !== 'complete' ? ` · ${t('exportEta', { time: eta(progress.etaMs) })}` : ''}</small>
        </div>}
        {report && <section className={`export-report ${report.verified ? 'verified' : 'warning'}`}>
          <header><strong>{report.verified ? `✓ ${t('verifiedExport')}` : `! ${t('exportNeedsReview')}`}</strong>
            <span>{clock(report.durationMs)} · {report.clipCount} {t('clips')}</span></header>
          <div className="export-checks">{report.checks.map(check => <div key={check.id} className={check.status}>
            <b>{check.status === 'passed' ? '✓' : check.status === 'warning' ? '!' : '×'}</b>
            <span><strong>{t(`exportCheck_${check.id}`, { defaultValue: check.label })}</strong>
              <small>{check.detailKey ? t(check.detailKey, { ...check.detailParams, defaultValue: check.detail }) : check.detail}</small></span>
          </div>)}</div>
          {(report.integratedLufs !== undefined || report.truePeakDbtp !== undefined) && <div className="export-metrics">
            <span><b>{report.integratedLufs?.toFixed(1) ?? '—'}</b> LUFS</span>
            <span><b>{report.loudnessRangeLu?.toFixed(1) ?? '—'}</b> LRA</span>
            <span><b>{report.truePeakDbtp?.toFixed(1) ?? '—'}</b> dBTP</span>
          </div>}
          {report.silenceIssues.length > 0 && <div className="silence-report">
            <h3>{t('silenceWarnings', { count: report.silenceIssues.length })}</h3>
            <div className="silence-mini-timeline">{report.silenceIssues.map((issue, index) => <button key={`${issue.startMs}-${index}`}
              style={{ left: `${Math.min(100, issue.startMs / Math.max(1, report.durationMs) * 100)}%` }}
              title={`${clock(issue.startMs)} · ${clock(issue.durationMs)}`} onClick={() => onSeek?.(issue.startMs)} />)}</div>
            <div className="silence-list">{report.silenceIssues.map((issue, index) => <button key={`${issue.endMs}-${index}`} onClick={() => onSeek?.(issue.startMs)}>
              <time>{clock(issue.startMs)}</time><b>{(issue.durationMs / 1000).toFixed(1)} s</b>
              <span>{issue.beforeClip && issue.afterClip ? `${issue.beforeClip} → ${issue.afterClip}` : issue.beforeClip || issue.afterClip || t('unknownRegion')}</span>
            </button>)}</div>
          </div>}
          <div className="export-hash"><span>SHA-256</span><code>{report.fileSha256}</code></div>
          <p className="export-result">✓ {t('exportComplete')}<small>{result.outputPath}</small><small>{t('verificationReport')}: {result.reportPath}</small></p>
        </section>}
        {failed && <p className="export-error">! {t('exportFailed')}<small>{failed}</small></p>}
      </div>
      <footer>
        {exporting ? <button className="secondary" onClick={() => void window.francisDesktop?.cancelExport()}>{t('cancelExport')}</button>
          : <button className="secondary" onClick={onClose}>{t('close')}</button>}
        <button className="export-primary" disabled={!canExport || exporting} onClick={async () => {
          setExporting(true); setProgress({ phase: 'preflight', percent: 0 }); setResult(null); setFailed('');
          try { const output = await onExport(settings); setResult(output); }
          catch (error) { setFailed(error instanceof Error ? error.message : String(error)); }
          finally { setExporting(false); }
        }}>{exporting ? t('exporting') : t('startExport')}</button>
      </footer>
    </section>
  </div>;
}
