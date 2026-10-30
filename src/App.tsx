import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChangeEvent } from 'react';
import { createArrangement } from './lib/arrangement';
import { createAutomationState, syncDefaultAutomationGroups } from './lib/automation';
import { formatBytes, formatDuration } from './lib/format';
import { filesToAssets } from './lib/media';
import { useTimelinePlayer } from './hooks/useTimelinePlayer';
import { AutomationEditor } from './components/AutomationEditor';
import type { Arrangement, ArrangementSettings, AudioSettings, AutomationState, MediaAsset, MediaKind, TimelineClip } from './types';

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

const defaultAudioSettings: AudioSettings = {
  musicGainDb: -3,
  voiceGainDb: -1,
  duckingGainDb: -40,
  fadeDownMs: 1500,
  fadeUpMs: 2000
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
  audioSettings: AudioSettings;
  automation: AutomationState | null;
  mounted: boolean;
  canMount: boolean;
  onChange: (patch: Partial<ArrangementSettings>) => void;
  onAudioChange: (patch: Partial<AudioSettings>) => void;
  onAutomationChange: (state: AutomationState) => void;
  onMount: () => void;
}

function SettingsPanel({ settings, audioSettings, automation, mounted, canMount, onChange, onAudioChange, onAutomationChange, onMount }: SettingsPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'arrangement' | 'audio' | 'automation'>('arrangement');
  const targetMinutes = Math.round(settings.targetDurationMs / 60_000);

  return <aside className="settings-panel">
    <div className="panel-heading settings-title">
      <div><h2>{t('setup')}</h2></div>
      <span className="sliders-icon">☷</span>
    </div>

    <div className="settings-tabs">
      {(['arrangement', 'audio', 'automation'] as const).map(item => <button key={item}
        className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{t(`settingsTab_${item}`)}</button>)}
    </div>

    {tab === 'arrangement' && <div className="settings-grid">
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
    </div>}

    {tab === 'audio' && <div className="settings-tab-content"><div className="audio-settings-heading"><h3>{t('audioMix')}</h3></div>
    <div className="audio-settings-grid">
      <DbField label={t('musicLevel')} value={audioSettings.musicGainDb}
        onChange={(musicGainDb) => onAudioChange({ musicGainDb })} />
      <DbField label={t('voiceLevel')} value={audioSettings.voiceGainDb}
        onChange={(voiceGainDb) => onAudioChange({ voiceGainDb })} />
      <DbField label={t('duckingLevel')} value={audioSettings.duckingGainDb} min={-80} max={0}
        onChange={(duckingGainDb) => onAudioChange({ duckingGainDb })} />
      <MsField label={t('fadeDown')} value={audioSettings.fadeDownMs}
        onChange={(fadeDownMs) => onAudioChange({ fadeDownMs })} />
      <MsField label={t('fadeUp')} value={audioSettings.fadeUpMs}
        onChange={(fadeUpMs) => onAudioChange({ fadeUpMs })} />
    </div></div>}

    {tab === 'automation' && <div className="settings-tab-content automation-settings">
      <Segmented label={t('displayLevelsAs')} value={automation?.displayUnit ?? 'percent'} full options={[
        ['percent', t('percentage')], ['db', 'dB']
      ]} onChange={(value) => automation && onAutomationChange({ ...automation, displayUnit: value as AutomationState['displayUnit'] })} />
      <Toggle label={t('showAutomations')} checked={automation?.visible ?? true}
        onChange={(visible) => automation && onAutomationChange({ ...automation, visible })} />
      <div className="shortcut-card"><kbd>⇧ Shift</kbd><p>{t('shiftAutomationHint')}</p></div>
      <p className="settings-help">{t('automationSettingsHelp')}</p>
    </div>}

    <button className="mount-button" disabled={!canMount} onClick={onMount}>
      <span className="mount-symbol">✦</span>{t(mounted ? 'remount' : 'mount')}<span className="arrow">→</span>
    </button>
  </aside>;
}

function DbField({ label, value, onChange, min = -60, max = 6 }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number;
}) {
  return <label className="field compact-field"><span>{label}</span><div className="number-field">
    <input type="number" min={min} max={max} step="0.5" value={value}
      onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value))))} /><em>dB</em>
  </div></label>;
}

function MsField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="field compact-field"><span>{label}</span><div className="number-field">
    <input type="number" min="0" max="30000" step="50" value={value}
      onChange={(event) => onChange(Math.min(30_000, Math.max(0, Number(event.target.value))))} /><em>ms</em>
  </div></label>;
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

interface TimelineProps {
  arrangement: Arrangement | null;
  isPlaying: boolean;
  positionMs: number;
  musicGainDb: number;
  automation: AutomationState | null;
  onAutomationChange: (state: AutomationState) => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (positionMs: number) => void;
}

function Timeline({ arrangement, isPlaying, positionMs, musicGainDb, automation, onAutomationChange, onPlay, onPause, onStop, onSeek }: TimelineProps) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const width = arrangement ? Math.max(100, arrangement.durationMs / 60_000 * 70 * zoom) : 100;
  const markerStepMs = arrangement && arrangement.durationMs <= 15 * 60_000 ? 60_000 : 5 * 60_000;
  const markers = arrangement ? Array.from({ length: Math.floor(arrangement.durationMs / markerStepMs) + 1 }, (_, index) => index * markerStepMs) : [];

  return <section className="timeline-section">
    <header className="timeline-header">
      <div><h2>{t('timeline')}</h2></div>
      <div className="zoom-control"><span>{t('zoom')}</span><button onClick={() => setZoom(Math.max(.5, zoom - .25))}>−</button>
        <output>{Math.round(zoom * 100)}%</output><button onClick={() => setZoom(Math.min(4, zoom + .25))}>＋</button></div>
    </header>

    {!arrangement ? <div className="timeline-empty"><div className="timeline-empty-icon">⌁⌁⌁</div><p>{t('timelineEmpty')}</p></div> : <>
      <div className="timeline-summary">{t('summary', { music: arrangement.music.filter(c => c.kind !== 'missing').length,
        voice: arrangement.voice.length, duration: formatDuration(arrangement.durationMs) })}</div>
      {arrangement.warnings.length > 0 && <div className="warnings">{arrangement.warnings.map(warning =>
        <p key={warning}>! {t(warning === 'missingMusic' ? 'warningMissingMusic' : 'warningVoiceOutside')}</p>)}</div>}
      <div className="transport">
        <button className="transport-primary" onClick={isPlaying ? onPause : onPlay}
          aria-label={t(isPlaying ? 'pauseProgram' : 'playProgram')}>{isPlaying ? 'Ⅱ' : '▶'}</button>
        <button className="transport-stop" onClick={onStop} aria-label={t('stopProgram')}>■</button>
        <time>{formatDuration(positionMs, true)}</time>
        <input type="range" min="0" max={arrangement.durationMs} step="100" value={positionMs}
          onChange={(event) => onSeek(Number(event.target.value))} />
        <time>{formatDuration(arrangement.durationMs)}</time>
        <div className="gain-meter"><span>{t('musicGain')}</span><strong>{musicGainDb.toFixed(1)} dB</strong>
          <i style={{ width: `${Math.max(0, Math.min(100, (musicGainDb + 80) / 80 * 100))}%` }} /></div>
      </div>
      <div className="timeline-shell">
        <div className="track-labels">
          <div className="ruler-spacer" />
          <div><span className="track-dot voice-dot" />{t('voiceTrack')}</div>
          <div><span className="track-dot music-dot" />{t('musicTrack')}</div>
          {automation?.visible && <div className="automation-track-label"><span className="track-dot automation-dot" />{t('automationTrack')}</div>}
        </div>
        <div className="timeline-scroll">
          <div className="timeline-canvas" style={{ width: `${width}%` }} onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            onSeek((event.clientX - bounds.left) / bounds.width * arrangement.durationMs);
          }}>
            <div className="ruler">{markers.map(marker => <div className="marker" key={marker}
              style={{ left: `${marker / arrangement.durationMs * 100}%` }}><span>{formatDuration(marker)}</span></div>)}</div>
            <div className="track voice-track">{arrangement.voice.map(clip => <TimelineClipView key={clip.id} clip={clip}
              totalMs={arrangement.durationMs} t={t} />)}</div>
            <div className="track music-track">{arrangement.music.map(clip => <TimelineClipView key={clip.id} clip={clip}
              totalMs={arrangement.durationMs} t={t} />)}</div>
            {automation?.visible && <AutomationEditor arrangement={arrangement} state={automation} onChange={onAutomationChange} />}
            <div className="playhead" style={{ left: `${positionMs / arrangement.durationMs * 100}%` }}><span /></div>
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
  const [audioSettings, setAudioSettings] = useState(defaultAudioSettings);
  const [arrangement, setArrangement] = useState<Arrangement | null>(null);
  const [automation, setAutomation] = useState<AutomationState | null>(null);
  const [activePreview, setActivePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const allAssets = useMemo(() => [...music, ...voices], [music, voices]);
  const assetsRef = useRef<MediaAsset[]>([]);
  assetsRef.current = allAssets;
  const player = useTimelinePlayer(arrangement, allAssets, audioSettings, automation);

  useEffect(() => () => {
    audio.current?.pause();
    assetsRef.current.forEach(asset => URL.revokeObjectURL(asset.previewUrl));
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
      setAutomation(null);
    } catch {
      setError(t('fileError'));
    }
  };

  const removeAsset = (id: string) => {
    const asset = allAssets.find(item => item.id === id);
    if (asset) URL.revokeObjectURL(asset.previewUrl);
    setMusic(current => current.filter(item => item.id !== id));
    setVoices(current => current.filter(item => item.id !== id));
    setArrangement(null);
    setAutomation(null);
  };

  const preview = (asset: MediaAsset) => {
    player.pause();
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
    player.stop();
    const next = createArrangement(music, voices, settings);
    setArrangement(next);
    setAutomation(createAutomationState(next, audioSettings));
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
        <SettingsPanel settings={settings} audioSettings={audioSettings} automation={automation} mounted={Boolean(arrangement)}
          canMount={music.length + voices.length > 0}
          onChange={(patch) => { player.stop(); setSettings(current => ({ ...current, ...patch })); setArrangement(null); setAutomation(null); }}
          onAudioChange={(patch) => {
            setAudioSettings(current => ({ ...current, ...patch }));
            setAutomation(current => current ? syncDefaultAutomationGroups(current, patch) : current);
          }}
          onAutomationChange={setAutomation} onMount={mount} />
      </div>
      <Timeline arrangement={arrangement} isPlaying={player.isPlaying} positionMs={player.positionMs}
        musicGainDb={player.musicGainDb} automation={automation} onAutomationChange={setAutomation}
        onPlay={() => { audio.current?.pause(); setActivePreview(null); player.play(); }}
        onPause={player.pause} onStop={player.stop} onSeek={player.seek} />
    </main>
  </div>;
}
