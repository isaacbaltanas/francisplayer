import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes, formatDuration } from '../lib/format';
import type { ImportLog, QuarantineItem } from '../types';

export function QuarantineDialog({ open, items, onClose, onAdmit }: {
  open: boolean;
  items: QuarantineItem[];
  onClose: () => void;
  onAdmit: (item: QuarantineItem) => void;
}) {
  const { t, i18n } = useTranslation();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  if (!open) return null;
  const preview = (item: QuarantineItem) => {
    audio.current?.pause();
    if (playingId === item.id) { setPlayingId(null); return; }
    const next = new Audio(item.previewUrl);
    next.onended = () => setPlayingId(null); next.onerror = () => setPlayingId(null);
    audio.current = next; void next.play(); setPlayingId(item.id);
  };
  return <div className="modal-backdrop"><section className="import-dialog" role="dialog" aria-modal="true">
    <header><div><span>{t('protectedFiles')}</span><h2>{t('quarantine')}</h2></div><button onClick={onClose}>×</button></header>
    <p className="dialog-explanation">{t('quarantineExplanation')}</p>
    <div className="quarantine-list">
      {items.length === 0 && <div className="empty-quarantine">✓ {t('quarantineEmpty')}</div>}
      {items.map(item => <article key={item.id}>
        <button className="preview-button" onClick={() => preview(item)}>{playingId === item.id ? '■' : '▶'}</button>
        <div><strong>{item.name}</strong><small>{formatBytes(item.sizeBytes, i18n.language)} · {item.durationMs ? formatDuration(item.durationMs) : t('unknownDuration')}</small>
          <em>{t(`quarantine_${item.reason}`)} · {item.detail}</em><code title={item.path}>{item.path}</code></div>
        <button className="admit-button" onClick={() => onAdmit(item)}>{t('admitFile')}</button>
      </article>)}
    </div>
    <footer><span>{t('quarantineCount', { count: items.length })}</span><button onClick={onClose}>{t('close')}</button></footer>
  </section></div>;
}

export function ImportLogDialog({ open, logs, onClose }: { open: boolean; logs: ImportLog[]; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState<string | null>(logs[0]?.id ?? null);
  if (!open) return null;
  return <div className="modal-backdrop"><section className="import-dialog log-dialog" role="dialog" aria-modal="true">
    <header><div><span>{t('importHistory')}</span><h2>{t('importLog')}</h2></div><button onClick={onClose}>×</button></header>
    <div className="import-log-list">
      {logs.length === 0 && <div className="empty-quarantine">{t('noImportLogs')}</div>}
      {logs.map(log => <article key={log.id}>
        <button className="log-summary" onClick={() => setExpanded(expanded === log.id ? null : log.id)}>
          <time>{new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(log.finishedAt))}</time>
          <span className="ok">✓ {log.importedCount}</span><span className="warn">Q {log.quarantinedCount}</span>
          <span className="duplicate">＝ {log.duplicateCount}</span><b>{expanded === log.id ? '⌃' : '⌄'}</b>
        </button>
        {expanded === log.id && <div className="log-entries">{log.entries.map((entry, index) => <div className={entry.outcome} key={`${entry.path}-${index}`}>
          <span>{entry.outcome === 'imported' ? '✓' : entry.outcome === 'duplicate' ? '＝' : 'Q'}</span>
          <strong>{entry.name}</strong><em>{entry.detail}</em><code title={entry.path}>{entry.path}</code>
        </div>)}</div>}
      </article>)}
    </div>
    <footer><span>{t('logNeverDeletes')}</span><button onClick={onClose}>{t('close')}</button></footer>
  </section></div>;
}
