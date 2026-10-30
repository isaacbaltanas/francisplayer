import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChangeEvent } from 'react';
import { createArrangement } from './lib/arrangement';
import { formatBytes, formatDuration } from './lib/format';
import { filesToAssets } from './lib/media';
import type { Arrangement, ArrangementSettings, MediaAsset, MediaKind, TimelineClip } from './types';

const defaultSettings: ArrangementSettings = {
  targetDurationMs: 74 * 60_000,
  musicOrder: 'sequential',
  voiceOrder: 'sequential',
  repeatMusic: true,
  voicePlacement: 'interval',
  voiceIntervalMs: 30_000,
  allowVoiceOverlap: false,
  seed: 2026
};

const acceptAudio = '.mp3,.wav,.m4a,.aac,.flac,.ogg,audio/*';

function BrandMark() {
  return <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /><span /></div>;
}

interface AssetListProps {
  kind: MediaKind;
  assets: MediaAsset[];
  activePreview: string | null;
  onFiles: (files: File[], kind: MediaKind) => void;
  onRemove: (id: string) => void;
  onPreview: (asset: MediaAsset) => void;
}

function AssetList({ kind, assets, activePreview, onFiles, onRemove, onPreview }: AssetListProps) {
  const { t, i18n } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const total = assets.reduce((sum, asset) => sum + asset.durationMs, 0);
  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    onFiles(Array.from(event.target.files ?? []), kind);
    event.target.value = '';
  };

  return <section className={`asset-panel ${kind}`}>
    <div className="panel-heading">
      <div>
        <p className="eyebrow">{kind === 'music' ? 'MUSIC' : 'VOICE'}</p>
        <h2>{t(kind === 'music' ? 'music' : 'voices')}</h2>
      </div>
      <span className="count-pill">{assets.length}</span>
    </div>

    <button className="import-button" onClick={() => input.current?.click()}>
      <span className="plus">＋</span>{t(kind === 'music' ? 'addMusic' : 'addVoice')}
    </button>
    <input ref={input} className="visually-hidden" type="file" multiple accept={acceptAudio} onChange={handleInput} />
    <p className="file-hint">{t('dropHint')}</p>

    <div className="asset-list">
      {assets.length === 0 && <div className="empty-list">
        <div className="empty-wave">⌁</div>
        <p>{t(kind === 'music' ? 'emptyMusic' : 'emptyVoice')}</p>
      </div>}
      {assets.map((asset, index) => <article className="asset-row" key={asset.id}>
        <button className={`preview-button ${activePreview === asset.id ? 'active' : ''}`} onClick={() => onPreview(asset)}
          aria-label={t(activePreview === asset.id ? 'pause' : 'play')}>
          {activePreview === asset.id ? '■' : '▶'}
        </button>
        <div className="asset-index">{String(index + 1).padStart(2, '0')}</div>
        <div className="asset-info">
          <strong title={asset.name}>{asset.name}</strong>
          <span>{formatDuration(asset.durationMs)} · {formatBytes(asset.sizeBytes, i18n.language)}</span>
        </div>
        <button className="remove-button" onClick={() => onRemove(asset.id)} aria-label={t('remove')}>×</button>
      </article>)}
    </div>

    <footer className="asset-footer">
      <span>{t('items', { count: assets.length })}</span>
      <span>{t('total', { duration: formatDuration(total) })}</span>
    </footer>
  </section>;
}

interface SettingsPanelProps {
  settings: ArrangementSettings;
  mounted: boolean;
  canMount: boolean;
  onChange: (patch: Partial<ArrangementSettings>) => void;
  onMount: () => void;
}

function SettingsPanel({ settings, mounted, canMount, onChange, onMount }: SettingsPanelProps) {
  const { t } = useTranslation();
  const targetMinutes = Math.round(settings.targetDurationMs / 60_000);

  return <aside className="settings-panel">
    <div className="panel-heading settings-title">
      <div><p className="eyebrow">ARRANGEMENT</p><h2>{t('setup')}</h2></div>
      <span className="sliders-icon">☷</span>
    </div>

    <div className="settings-grid">
      <label className="field full">
        <span>{t('targetDuration')}</span>
        <div className="number-field"><input type="number" min="1" max="360" value={targetMinutes}
          onChange={(event) => onChange({ targetDurationMs: Math.max(1, Number(event.target.value)) * 60_000 })} />
          <em>{t('minutes')}</em></div>
      </label>

      <Segmented label={t('musicOrder')} value={settings.musicOrder} options={[
        ['sequential', t('sequential')], ['random', t('random')]
      ]} onChange={(value) => onChange({ musicOrder: value as ArrangementSettings['musicOrder'] })} />

      <Segmented label={t('voiceOrder')} value={settings.voiceOrder} options={[
        ['sequential', t('sequential')], ['random', t('random')]
      ]} onChange={(value) => onChange({ voiceOrder: value as ArrangementSettings['voiceOrder'] })} />

      <Toggle label={t('repeatMusic')} checked={settings.repeatMusic} onChange={(repeatMusic) => onChange({ repeatMusic })} />

      <Segmented label={t('voicePlacement')} value={settings.voicePlacement} full options={[
        ['interval', t('interval')], ['uniform', t('uniform')]
      ]} onChange={(value) => onChange({ voicePlacement: value as ArrangementSettings['voicePlacement'] })} />

      {settings.voicePlacement === 'interval' && <label className="field full">
        <span>{t('intervalSeconds')}</span>
        <div className="number-field"><input type="number" min="1" max="3600" value={settings.voiceIntervalMs / 1000}
          onChange={(event) => onChange({ voiceIntervalMs: Math.max(1, Number(event.target.value)) * 1000 })} />
          <em>{t('seconds')}</em></div>
      </label>}

      <Toggle label={t('allowOverlap')} checked={settings.allowVoiceOverlap} onChange={(allowVoiceOverlap) => onChange({ allowVoiceOverlap })} />

      <label className="field seed-field">
        <span>{t('seed')}</span>
        <input type="number" value={settings.seed} onChange={(event) => onChange({ seed: Number(event.target.value) || 1 })} />
      </label>
    </div>

    <button className="mount-button" disabled={!canMount} onClick={onMount}>
      <span className="mount-symbol">✦</span>{t(mounted ? 'remount' : 'mount')}<span className="arrow">→</span>
    </button>
  </aside>;
}

function Segmented({ label, value, options, onChange, full = false }: {
  label: string; value: string; options: [string, string][]; onChange: (value: string) => void; full?: boolean;
}) {
  return <div className={`field segmented-field ${full ? 'full' : ''}`}>
    <span>{label}</span>
    <div className="segmented">{options.map(([option, title]) =>
      <button key={option} className={value === option ? 'selected' : ''} onClick={() => onChange(option)}>{title}</button>
    )}</div>
  </div>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-field"><span>{label}</span><input type="checkbox" checked={checked}
    onChange={(event) => onChange(event.target.checked)} /><i /></label>;
}

function TimelineClipView({ clip, totalMs, t }: { clip: TimelineClip; totalMs: number; t: (key: string) => string }) {
  const left = (clip.startMs / totalMs) * 100;
  const width = Math.max((clip.durationMs / totalMs) * 100, 0.18);
  const style = { left: `${left}%`, width: `${width}%`, backgroundColor: clip.color };
  return <div className={`timeline-clip ${clip.kind} ${clip.truncated ? 'truncated' : ''}`} style={style}
    title={`${clip.kind === 'missing' ? t('missingMusic') : clip.name} · ${formatDuration(clip.durationMs)}`}>
    <span>{clip.kind === 'missing' ? t('missingMusic') : clip.name}</span>
    {clip.kind !== 'missing' && <small>{formatDuration(clip.durationMs)}</small>}
  </div>;
}

function Timeline({ arrangement }: { arrangement: Arrangement | null }) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const width = arrangement ? Math.max(100, arrangement.durationMs / 60_000 * 70 * zoom) : 100;
  const markerStepMs = arrangement && arrangement.durationMs <= 15 * 60_000 ? 60_000 : 5 * 60_000;
  const markers = arrangement ? Array.from({ length: Math.floor(arrangement.durationMs / markerStepMs) + 1 }, (_, index) => index * markerStepMs) : [];

  return <section className="timeline-section">
    <header className="timeline-header">
      <div><p className="eyebrow">PROGRAM</p><h2>{t('timeline')}</h2></div>
      <div className="zoom-control"><span>{t('zoom')}</span><button onClick={() => setZoom(Math.max(.5, zoom - .25))}>−</button>
        <output>{Math.round(zoom * 100)}%</output><button onClick={() => setZoom(Math.min(4, zoom + .25))}>＋</button></div>
    </header>

    {!arrangement ? <div className="timeline-empty"><div className="timeline-empty-icon">⌁⌁⌁</div><p>{t('timelineEmpty')}</p></div> : <>
      <div className="timeline-summary">{t('summary', { music: arrangement.music.filter(c => c.kind !== 'missing').length,
        voice: arrangement.voice.length, duration: formatDuration(arrangement.durationMs) })}</div>
      {arrangement.warnings.length > 0 && <div className="warnings">{arrangement.warnings.map(warning =>
        <p key={warning}>! {t(warning === 'missingMusic' ? 'warningMissingMusic' : 'warningVoiceOutside')}</p>)}</div>}
      <div className="timeline-shell">
        <div className="track-labels">
          <div className="ruler-spacer" />
          <div><span className="track-dot voice-dot" />{t('voiceTrack')}</div>
          <div><span className="track-dot music-dot" />{t('musicTrack')}</div>
        </div>
        <div className="timeline-scroll">
          <div className="timeline-canvas" style={{ width: `${width}%` }}>
            <div className="ruler">{markers.map(marker => <div className="marker" key={marker}
              style={{ left: `${marker / arrangement.durationMs * 100}%` }}><span>{formatDuration(marker)}</span></div>)}</div>
            <div className="track voice-track">{arrangement.voice.map(clip => <TimelineClipView key={clip.id} clip={clip}
              totalMs={arrangement.durationMs} t={t} />)}</div>
            <div className="track music-track">{arrangement.music.map(clip => <TimelineClipView key={clip.id} clip={clip}
              totalMs={arrangement.durationMs} t={t} />)}</div>
          </div>
        </div>
      </div>
    </>}
  </section>;
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [music, setMusic] = useState<MediaAsset[]>([]);
  const [voices, setVoices] = useState<MediaAsset[]>([]);
  const [settings, setSettings] = useState(defaultSettings);
  const [arrangement, setArrangement] = useState<Arrangement | null>(null);
  const [activePreview, setActivePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => {
    audio.current?.pause();
    [...music, ...voices].forEach(asset => URL.revokeObjectURL(asset.previewUrl));
  }, []); // URLs are intentionally cleaned only when the app closes.

  const status = useMemo(() => arrangement ? formatDuration(arrangement.durationMs) : t('projectReady'), [arrangement, t]);

  const addFiles = async (files: File[], kind: MediaKind) => {
    if (!files.length) return;
    setError(null);
    try {
      const assets = await filesToAssets(files, kind);
      if (kind === 'music') setMusic(current => [...current, ...assets]);
      else setVoices(current => [...current, ...assets]);
      setArrangement(null);
    } catch {
      setError(t('fileError'));
    }
  };

  const removeAsset = (id: string) => {
    const asset = [...music, ...voices].find(item => item.id === id);
    if (asset) URL.revokeObjectURL(asset.previewUrl);
    setMusic(current => current.filter(item => item.id !== id));
    setVoices(current => current.filter(item => item.id !== id));
    setArrangement(null);
  };

  const preview = (asset: MediaAsset) => {
    if (activePreview === asset.id) {
      audio.current?.pause();
      setActivePreview(null);
      return;
    }
    audio.current?.pause();
    const next = new Audio(asset.previewUrl);
    next.onended = () => setActivePreview(null);
    next.onerror = () => setActivePreview(null);
    audio.current = next;
    void next.play();
    setActivePreview(asset.id);
  };

  const mount = () => {
    setArrangement(createArrangement(music, voices, settings));
  };

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><BrandMark /><div><h1>Francis Player</h1><p>{t('appSubtitle')}</p></div></div>
      <div className="project-state"><span className="draft-pill">{t('statusDraft')}</span><div><strong>{t('newProject')}</strong><small>{status}</small></div></div>
      <div className="language-switch" aria-label={t('language')}>
        <button className={i18n.language === 'es' ? 'active' : ''} onClick={() => void i18n.changeLanguage('es')}>{t('spanish')}</button>
        <button className={i18n.language === 'en' ? 'active' : ''} onClick={() => void i18n.changeLanguage('en')}>{t('english')}</button>
      </div>
    </header>

    <main>
      {error && <div className="error-banner">{error}<button onClick={() => setError(null)}>×</button></div>}
      <div className="workspace-grid">
        <div className="library-area">
          <AssetList kind="music" assets={music} activePreview={activePreview} onFiles={addFiles}
            onRemove={removeAsset} onPreview={preview} />
          <AssetList kind="voice" assets={voices} activePreview={activePreview} onFiles={addFiles}
            onRemove={removeAsset} onPreview={preview} />
        </div>
        <SettingsPanel settings={settings} mounted={Boolean(arrangement)} canMount={music.length + voices.length > 0}
          onChange={(patch) => { setSettings(current => ({ ...current, ...patch })); setArrangement(null); }} onMount={mount} />
      </div>
      <Timeline arrangement={arrangement} />
    </main>
  </div>;
}
