import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChangeEvent } from 'react';
import { createArrangement, rebuildMissingMusic } from './lib/arrangement';
import { addAutomationAssignment, createAutomationState, removeAutomationAssignment, syncDefaultAutomationGroups } from './lib/automation';
import { formatBytes, formatDuration } from './lib/format';
import { filesToAssets } from './lib/media';
import { useTimelinePlayer } from './hooks/useTimelinePlayer';
import { AutomationEditor } from './components/AutomationEditor';
import { TrackAutomationLane } from './components/TrackAutomationLane';
import { ExportDialog } from './components/ExportDialog';
import { ImportLogDialog, QuarantineDialog } from './components/ImportCenterDialog';
import { snapClipStart } from './lib/snapping';
import { createInsertionSequence } from './lib/insertion';
import { overlappingClipIds } from './lib/overlaps';
import type { Arrangement, ArrangementSettings, AudioSettings, AutomationState, EditingPreferences, ExportSettings, ImportLog, InsertionConfig, LibraryTab, MediaAsset, MediaKind, QuarantineItem, TimelineClip } from './types';

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

const defaultEditingPreferences: EditingPreferences = {
  snapEnabled: true,
  snapMode: 'smart',
  snapGridMs: 1000,
  allowAssetReuse: true,
  verifyFileIntegrity: true
};

const acceptAudio = '.mp3,.wav,.m4a,.aac,.flac,.ogg,audio/*';
const tabColors = ['#4f8cff', '#de6ea8', '#4eb6a1', '#d4a63d', '#9b72cf', '#e77d50'];
const initialTabs: LibraryTab[] = [
  { id: 'music-1', kind: 'music', name: 'Música 1', color: '#4f8cff', localAutomationEnabled: false, automationPoints: [] },
  { id: 'voice-1', kind: 'voice', name: 'Locuciones 1', color: '#de6ea8', localAutomationEnabled: false, automationPoints: [] }
];
const defaultInsertion: InsertionConfig = { mode: 'all', customPattern: '1, 2, 1, 3' };

interface ProjectDocument {
  name: string;
  version: string;
  settings: ArrangementSettings;
  audioSettings: AudioSettings;
  editingPreferences: EditingPreferences;
  libraryTabs: LibraryTab[];
  activeMusicTabId: string;
  activeVoiceTabId: string;
  musicInsertion: InsertionConfig;
  voiceInsertion: InsertionConfig;
  arrangement: Arrangement | null;
  automation: AutomationState | null;
  assets: MediaAsset[];
  quarantine: QuarantineItem[];
  importLogs: ImportLog[];
}

function BrandMark() {
  return <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /><span /></div>;
}

interface AssetListProps {
  kind: MediaKind;
  assets: MediaAsset[];
  tabs: LibraryTab[];
  activeTabId: string;
  insertion: InsertionConfig;
  activePreview: string | null;
  occurrences: Map<string, number>;
  highlightedAssetIds: Set<string>;
  allowAssetReuse: boolean;
  onFiles: (files: File[], kind: MediaKind, tabId: string) => void;
  onRemove: (id: string) => void;
  onPreview: (asset: MediaAsset) => void;
  onToggleHighlight: (id: string) => void;
  onSelectTab: (id: string) => void;
  onAddTab: (kind: MediaKind) => void;
  onRenameTab: (id: string, name: string) => void;
  onMoveTab: (id: string, direction: -1 | 1) => void;
  onRemoveTab: (id: string) => void;
  onToggleLocalAutomation: (id: string) => void;
  onInsertionChange: (patch: Partial<InsertionConfig>) => void;
}

function AssetList({ kind, assets, tabs, activeTabId, insertion, activePreview, occurrences, highlightedAssetIds, allowAssetReuse,
  onFiles, onRemove, onPreview, onToggleHighlight, onSelectTab, onAddTab, onRenameTab, onMoveTab, onRemoveTab,
  onToggleLocalAutomation, onInsertionChange }: AssetListProps) {
  const { t, i18n } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const visibleAssets = assets.filter(asset => asset.libraryTabId === activeTabId);
  const total = visibleAssets.reduce((sum, asset) => sum + asset.durationMs, 0);
  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    onFiles(Array.from(event.target.files ?? []), kind, activeTabId);
    event.target.value = '';
  };

  return <section className={`asset-panel ${kind}`} onDragOver={(event) => {
    if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
  }} onDrop={(event) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault(); onFiles(Array.from(event.dataTransfer.files), kind, activeTabId);
  }}>
    <div className="panel-heading">
      <div>
        <h2>{t(kind === 'music' ? 'music' : 'voices')}</h2>
      </div>
      <span className="count-pill">{assets.length}</span>
    </div>

    <div className="library-tabs">
      {tabs.map((tab, index) => <div className={`library-tab ${tab.id === activeTabId ? 'active' : ''}`} key={tab.id}>
        <button className="tab-select" onClick={() => onSelectTab(tab.id)} onDoubleClick={() => {
          const name = window.prompt(t('renameList'), tab.name)?.trim();
          if (name) onRenameTab(tab.id, name);
        }}><i style={{ background: tab.color }} />{tab.name}<small>{assets.filter(asset => asset.libraryTabId === tab.id).length}</small></button>
        {tab.id === activeTabId && <div className="tab-actions">
          <button onClick={() => onMoveTab(tab.id, -1)} disabled={index === 0} title={t('moveListLeft')}>‹</button>
          <button onClick={() => onMoveTab(tab.id, 1)} disabled={index === tabs.length - 1} title={t('moveListRight')}>›</button>
          <button className={tab.localAutomationEnabled ? 'active' : ''} onClick={() => onToggleLocalAutomation(tab.id)} title={t('localAutomation')}>A</button>
          <button onClick={() => onRemoveTab(tab.id)} disabled={tabs.length === 1} title={t('deleteList')}>×</button>
        </div>}
      </div>)}
      <button className="add-tab" onClick={() => onAddTab(kind)} title={t('newList')}>＋</button>
    </div>

    <div className="import-actions"><button className="import-button" onClick={() => input.current?.click()}>
      <span className="plus">＋</span>{t(kind === 'music' ? 'addMusic' : 'addVoice')}
    </button><button className="folder-button" onClick={() => folderInput.current?.click()} title={t('addFolder')}>▰</button></div>
    <input ref={input} className="visually-hidden" type="file" multiple accept={acceptAudio} onChange={handleInput} />
    <input ref={folderInput} className="visually-hidden" type="file" multiple {...({ webkitdirectory: '' } as object)} onChange={handleInput} />
    <p className="file-hint">{t('dropHint')}</p>

    <div className="asset-list">
      {visibleAssets.length === 0 && <div className="empty-list">
        <div className="empty-wave">⌁</div>
        <p>{t(kind === 'music' ? 'emptyMusic' : 'emptyVoice')}</p>
      </div>}
      {visibleAssets.map((asset, index) => {
        const occurrenceCount = occurrences.get(asset.id) ?? 0;
        const locked = !allowAssetReuse && occurrenceCount > 0;
        const highlighted = highlightedAssetIds.has(asset.id);
        return <article className={`asset-row ${locked ? 'asset-locked' : ''} ${highlighted ? 'asset-highlighted' : ''}`} key={asset.id}
          draggable={!locked} onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData('application/x-francis-asset', JSON.stringify({ assetId: asset.id, kind: asset.kind }));
          }}>
        <button className={`preview-button ${activePreview === asset.id ? 'active' : ''}`} onClick={() => onPreview(asset)}
          aria-label={t(activePreview === asset.id ? 'pause' : 'play')}>
          {activePreview === asset.id ? '■' : '▶'}
        </button>
        <div className="asset-index">{String(index + 1).padStart(2, '0')}</div>
        <div className="asset-info">
          <strong title={asset.name}>{asset.name}</strong>
          <span>{asset.durationMs ? formatDuration(asset.durationMs) : '—'} · {formatBytes(asset.sizeBytes, i18n.language)}
            {asset.integrity === 'warning' && <b className="integrity-warning" title={t('admittedWithWarning')}> · !</b>}</span>
        </div>
        <span className={`occurrence-badge ${occurrenceCount > 0 ? 'used' : ''}`} title={t('timelineOccurrences', { count: occurrenceCount })}>{occurrenceCount}</span>
        <button className={`highlight-button ${highlighted ? 'active' : ''}`} onClick={() => onToggleHighlight(asset.id)}
          aria-label={t('highlightOccurrences')}>◉</button>
        <button className="remove-button" onClick={() => onRemove(asset.id)} aria-label={t('remove')}>×</button>
      </article>;})}
    </div>

    <div className="insertion-logic">
      <label><span>{t('insertionLogic')}</span><select value={insertion.mode}
        onChange={(event) => onInsertionChange({ mode: event.target.value as InsertionConfig['mode'] })}>
        <option value="active">{t('insertActive')}</option><option value="all">{t('insertAll')}</option>
        <option value="roundRobin">{t('insertRoundRobin')}</option><option value="random">{t('insertRandom')}</option>
        <option value="custom">{t('insertCustom')}</option>
      </select></label>
      {insertion.mode === 'custom' && <input value={insertion.customPattern}
        onChange={(event) => onInsertionChange({ customPattern: event.target.value })} placeholder="1, 2, 1, 3" />}
    </div>

    <footer className="asset-footer">
      <span>{t('items', { count: visibleAssets.length })}</span>
      <span>{t('total', { duration: formatDuration(total) })}</span>
    </footer>
  </section>;
}

interface SettingsPanelProps {
  settings: ArrangementSettings;
  audioSettings: AudioSettings;
  automation: AutomationState | null;
  editingPreferences: EditingPreferences;
  mounted: boolean;
  canMount: boolean;
  onChange: (patch: Partial<ArrangementSettings>) => void;
  onAudioChange: (patch: Partial<AudioSettings>) => void;
  onAutomationChange: (state: AutomationState) => void;
  onEditingPreferencesChange: (patch: Partial<EditingPreferences>) => void;
  onMount: () => void;
}

function SettingsPanel({ settings, audioSettings, automation, editingPreferences, mounted, canMount, onChange, onAudioChange, onAutomationChange, onEditingPreferencesChange, onMount }: SettingsPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'arrangement' | 'audio' | 'automation' | 'editing'>('arrangement');
  const targetMinutes = Math.round(settings.targetDurationMs / 60_000);

  return <aside className="settings-panel">
    <div className="panel-heading settings-title">
      <div><h2>{t('setup')}</h2></div>
      <span className="sliders-icon">☷</span>
    </div>

    <div className="settings-tabs">
      {(['arrangement', 'audio', 'automation', 'editing'] as const).map(item => <button key={item}
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

    {tab === 'editing' && <div className="settings-tab-content automation-settings">
      <Toggle label={t('enableSnap')} checked={editingPreferences.snapEnabled}
        onChange={(snapEnabled) => onEditingPreferencesChange({ snapEnabled })} />
      <Segmented label={t('snapMode')} value={editingPreferences.snapMode} full options={[
        ['smart', t('snapSmart')], ['grid', t('snapGrid')], ['edges', t('snapEdges')], ['original', t('snapOriginal')]
      ]} onChange={(value) => onEditingPreferencesChange({ snapMode: value as EditingPreferences['snapMode'] })} />
      <label className="field full"><span>{t('gridStep')}</span><div className="number-field">
        <input type="number" min="10" max="60000" step="10" value={editingPreferences.snapGridMs}
          onChange={(event) => onEditingPreferencesChange({ snapGridMs: Math.max(10, Number(event.target.value)) })} /><em>ms</em>
      </div></label>
      <Toggle label={t('allowAssetReuse')} checked={editingPreferences.allowAssetReuse}
        onChange={(allowAssetReuse) => onEditingPreferencesChange({ allowAssetReuse })} />
      <Toggle label={t('verifyFileIntegrity')} checked={editingPreferences.verifyFileIntegrity}
        onChange={(verifyFileIntegrity) => onEditingPreferencesChange({ verifyFileIntegrity })} />
      <p className="settings-help">{t('integrityHelp')}</p>
      <p className="settings-help">{t('snapControlHint')}</p>
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

function TimelineClipView({ clip, waveform, overlapping, arrangement, canvasRef, preferences, dimmed, highlighted, onMove, onRemove, onFadeChange, onDragEnd }: {
  clip: TimelineClip;
  waveform: number[];
  overlapping: boolean;
  arrangement: Arrangement;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  preferences: EditingPreferences;
  dimmed: boolean;
  highlighted: boolean;
  onMove: (clipId: string, kind: TimelineClip['kind'], startMs: number, guideMs: number | null) => void;
  onRemove: (clip: TimelineClip) => void;
  onFadeChange: (clipId: string, kind: TimelineClip['kind'], edge: 'in' | 'out', durationMs: number) => void;
  onDragEnd: () => void;
}) {
  const { t } = useTranslation();
  const [drag, setDrag] = useState<{ clientX: number; startMs: number } | null>(null);
  const [fadeDrag, setFadeDrag] = useState<{ edge: 'in' | 'out'; clientX: number; initialMs: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const totalMs = arrangement.durationMs;
  const left = (clip.startMs / totalMs) * 100;
  const width = Math.max((clip.durationMs / totalMs) * 100, 0.18);
  const style = { left: `${left}%`, width: `${width}%`, backgroundColor: clip.color };
  const fadeInPercent = Math.min(100, (clip.fadeInMs ?? 0) / clip.durationMs * 100);
  const fadeOutPercent = Math.min(100, (clip.fadeOutMs ?? 0) / clip.durationMs * 100);
  const startFadeDrag = (event: React.PointerEvent<HTMLButtonElement>, edge: 'in' | 'out') => {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    setFadeDrag({ edge, clientX: event.clientX, initialMs: edge === 'in' ? (clip.fadeInMs ?? 0) : (clip.fadeOutMs ?? 0) });
  };
  return <div className={`timeline-clip ${clip.kind} ${clip.truncated ? 'truncated' : ''} ${drag ? 'dragging' : ''} ${dimmed ? 'clip-dimmed' : ''} ${highlighted ? 'clip-highlighted' : ''} ${overlapping ? 'clip-overlapping' : ''}`} style={style}
    title={`${clip.kind === 'missing' ? t('missingMusic') : clip.name} · ${formatDuration(clip.durationMs)}`}
    onPointerDown={(event) => {
      if (clip.kind === 'missing' || event.button !== 0) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ clientX: event.clientX, startMs: clip.startMs });
      setMenu(null);
    }}
    onPointerMove={(event) => {
      if (!drag || !canvasRef.current) return;
      event.stopPropagation();
      const widthPx = canvasRef.current.getBoundingClientRect().width;
      const proposed = drag.startMs + (event.clientX - drag.clientX) / widthPx * arrangement.durationMs;
      if (!preferences.snapEnabled || event.ctrlKey) {
        onMove(clip.id, clip.kind, Math.max(0, Math.min(arrangement.durationMs - clip.durationMs, proposed)), null);
        return;
      }
      const snapped = snapClipStart({
        proposedStartMs: proposed, clip, arrangement, mode: preferences.snapMode,
        gridMs: preferences.snapGridMs, toleranceMs: arrangement.durationMs / widthPx * 10
      });
      onMove(clip.id, clip.kind, snapped.startMs, snapped.guideMs);
    }}
    onPointerUp={(event) => { event.stopPropagation(); setDrag(null); onDragEnd(); }}
    onPointerCancel={() => { setDrag(null); onDragEnd(); }}
    onContextMenu={(event) => {
      if (clip.kind === 'missing') return;
      event.preventDefault(); event.stopPropagation();
      setMenu({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY });
    }}>
    {clip.kind !== 'missing' && <svg className="clip-waveform" viewBox={`0 0 ${Math.max(1, waveform.length)} 100`} preserveAspectRatio="none" aria-hidden="true">
      {waveform.map((peak, index) => <line key={index} x1={index + .5} x2={index + .5} y1={50 - peak * 43} y2={50 + peak * 43} />)}
    </svg>}
    {clip.kind !== 'missing' && <svg className="clip-fades" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {fadeInPercent > 0 && <path d={`M0 100 Q ${fadeInPercent * .35} 10 ${fadeInPercent} 0`} />}
      {fadeOutPercent > 0 && <path d={`M${100 - fadeOutPercent} 0 Q ${100 - fadeOutPercent * .35} 10 100 100`} />}
    </svg>}
    {clip.kind !== 'missing' && <button className="fade-handle fade-in" title={t('fadeInHandle')}
      onPointerDown={(event) => startFadeDrag(event, 'in')} onPointerMove={(event) => {
        if (!fadeDrag || fadeDrag.edge !== 'in') return; event.stopPropagation();
        const px = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 1;
        onFadeChange(clip.id, clip.kind, 'in', Math.max(0, Math.min(clip.durationMs, fadeDrag.initialMs + (event.clientX - fadeDrag.clientX) / px * clip.durationMs)));
      }} onPointerUp={() => setFadeDrag(null)}>◢</button>}
    {clip.kind !== 'missing' && <button className="fade-handle fade-out" title={t('fadeOutHandle')}
      onPointerDown={(event) => startFadeDrag(event, 'out')} onPointerMove={(event) => {
        if (!fadeDrag || fadeDrag.edge !== 'out') return; event.stopPropagation();
        const px = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 1;
        onFadeChange(clip.id, clip.kind, 'out', Math.max(0, Math.min(clip.durationMs, fadeDrag.initialMs - (event.clientX - fadeDrag.clientX) / px * clip.durationMs)));
      }} onPointerUp={() => setFadeDrag(null)}>◣</button>}
    <span>{clip.kind === 'missing' ? t('missingMusic') : clip.name}</span>
    {clip.kind !== 'missing' && <small>{formatDuration(clip.durationMs)}</small>}
    {clip.manuallyPositioned && <i className="manual-position-dot" title={t('manuallyPositioned')} />}
    {menu && <div className="clip-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
      <button onClick={(event) => { event.stopPropagation(); onMove(clip.id, clip.kind, clip.generatedStartMs, clip.generatedStartMs); setMenu(null); }}>↩ {t('restoreGeneratedPosition')}</button>
      <button className="danger" onClick={(event) => { event.stopPropagation(); onRemove(clip); setMenu(null); }}>× {t('removeFromTimeline')}</button>
      <button onClick={(event) => { event.stopPropagation(); setMenu(null); }}>{t('close')}</button>
    </div>}
  </div>;
}

interface TimelineProps {
  arrangement: Arrangement | null;
  tabs: LibraryTab[];
  assets: MediaAsset[];
  isPlaying: boolean;
  positionMs: number;
  musicGainDb: number;
  automation: AutomationState | null;
  editingPreferences: EditingPreferences;
  highlightedAssetIds: Set<string>;
  onAutomationChange: (state: AutomationState) => void;
  onEditingPreferencesChange: (patch: Partial<EditingPreferences>) => void;
  onMoveClip: (clipId: string, kind: TimelineClip['kind'], startMs: number, guideMs: number | null) => void;
  onRemoveClip: (clip: TimelineClip) => void;
  onFadeChange: (clipId: string, kind: TimelineClip['kind'], edge: 'in' | 'out', durationMs: number) => void;
  onTabChange: (id: string, patch: Partial<LibraryTab>) => void;
  onDropAsset: (assetId: string, kind: MediaKind, startMs: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (positionMs: number) => void;
}

function Timeline({ arrangement, tabs, assets, isPlaying, positionMs, musicGainDb, automation, editingPreferences, highlightedAssetIds,
  onAutomationChange, onEditingPreferencesChange, onMoveClip, onRemoveClip, onFadeChange, onTabChange, onDropAsset, onPlay, onPause, onStop, onSeek }: TimelineProps) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const [snapGuideMs, setSnapGuideMs] = useState<number | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const width = arrangement ? Math.max(100, arrangement.durationMs / 60_000 * 70 * zoom) : 100;
  const markerStepMs = arrangement && arrangement.durationMs <= 15 * 60_000 ? 60_000 : 5 * 60_000;
  const markers = arrangement ? Array.from({ length: Math.floor(arrangement.durationMs / markerStepMs) + 1 }, (_, index) => index * markerStepMs) : [];
  const timelineTabs = [...tabs.filter(tab => tab.kind === 'voice'), ...tabs.filter(tab => tab.kind === 'music')];
  const waveforms = new Map(assets.map(asset => [asset.id, asset.waveform]));
  const voiceOverlaps = arrangement ? overlappingClipIds(arrangement.voice) : new Set<string>();

  return <section className="timeline-section">
    <header className="timeline-header">
      <div><h2>{t('timeline')}</h2></div>
      <div className="timeline-tools"><button className={`magnet-button ${editingPreferences.snapEnabled ? 'active' : ''}`}
        onClick={() => onEditingPreferencesChange({ snapEnabled: !editingPreferences.snapEnabled })}
        title={t('toggleSnap')}>🧲</button>
      <select value={editingPreferences.snapMode} onChange={(event) => onEditingPreferencesChange({ snapMode: event.target.value as EditingPreferences['snapMode'] })}
        aria-label={t('snapMode')}>
        <option value="smart">{t('snapSmart')}</option><option value="grid">{t('snapGrid')}</option>
        <option value="edges">{t('snapEdges')}</option><option value="original">{t('snapOriginal')}</option>
      </select>
      <div className="zoom-control"><span>{t('zoom')}</span><button onClick={() => setZoom(Math.max(.5, zoom - .25))}>−</button>
        <output>{Math.round(zoom * 100)}%</output><button onClick={() => setZoom(Math.min(4, zoom + .25))}>＋</button></div>
      </div>
    </header>

    {!arrangement ? <div className="timeline-empty"><div className="timeline-empty-icon">⌁⌁⌁</div><p>{t('timelineEmpty')}</p></div> : <>
      <div className="timeline-summary">{t('summary', { music: arrangement.music.filter(c => c.kind !== 'missing').length,
        voice: arrangement.voice.length, duration: formatDuration(arrangement.durationMs) })}</div>
      {arrangement.warnings.length > 0 && <div className="warnings">{arrangement.warnings.map(warning =>
        <p key={warning}>! {t(warning === 'missingMusic' ? 'warningMissingMusic' : 'warningVoiceOutside')}</p>)}</div>}
      {voiceOverlaps.size > 0 && <div className="warnings overlap-warning"><p>! {t('warningVoiceOverlap', { count: voiceOverlaps.size })}</p></div>}
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
          {timelineTabs.map(tab => <div key={tab.id} title={tab.name}><span className="track-dot" style={{ background: tab.color }} />
            <span className="track-name">{tab.name}</span>{tab.localAutomationEnabled && <small> A</small>}</div>)}
          {automation?.visible && <div className="automation-track-label"><span className="track-dot automation-dot" />{t('automationTrack')}</div>}
        </div>
        <div className="timeline-scroll">
          <div ref={canvasRef} className="timeline-canvas" style={{ width: `${width}%` }} onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            onSeek((event.clientX - bounds.left) / bounds.width * arrangement.durationMs);
          }} onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-francis-asset')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
          onDrop={(event) => {
            event.preventDefault(); event.stopPropagation();
            try {
              const data = JSON.parse(event.dataTransfer.getData('application/x-francis-asset')) as { assetId: string; kind: MediaKind };
              const bounds = event.currentTarget.getBoundingClientRect();
              onDropAsset(data.assetId, data.kind, (event.clientX - bounds.left) / bounds.width * arrangement.durationMs);
            } catch { /* Ignore unrelated drops. */ }
          }}>
            <div className="ruler">{markers.map(marker => <div className="marker" key={marker}
              style={{ left: `${marker / arrangement.durationMs * 100}%` }}><span>{formatDuration(marker)}</span></div>)}</div>
            {timelineTabs.map((tab, tabIndex) => <div className={`track ${tab.kind}-track`} key={tab.id}>
              {(tab.kind === 'voice' ? arrangement.voice : arrangement.music).filter(clip => clip.libraryTabId === tab.id ||
                (clip.kind === 'missing' && tab.kind === 'music' && tabIndex === timelineTabs.findIndex(item => item.kind === 'music')))
                .map(clip => <TimelineClipView key={clip.id} clip={clip}
                  waveform={clip.assetId ? (waveforms.get(clip.assetId) ?? []) : []} overlapping={voiceOverlaps.has(clip.id)}
                  arrangement={arrangement} canvasRef={canvasRef} preferences={editingPreferences}
                  dimmed={highlightedAssetIds.size > 0 && !highlightedAssetIds.has(clip.assetId ?? '')}
                  highlighted={highlightedAssetIds.has(clip.assetId ?? '')}
                  onMove={(...args) => { setSnapGuideMs(args[3]); onMoveClip(...args); }} onRemove={onRemoveClip} onFadeChange={onFadeChange}
                  onDragEnd={() => setSnapGuideMs(null)} />)}
              {tab.localAutomationEnabled && <TrackAutomationLane tab={tab}
                onChange={(automationPoints) => onTabChange(tab.id, { automationPoints })} />}
            </div>)}
            {automation?.visible && <AutomationEditor arrangement={arrangement} state={automation} onChange={onAutomationChange} />}
            {snapGuideMs !== null && <div className="snap-guide" style={{ left: `${snapGuideMs / arrangement.durationMs * 100}%` }}><span>{formatDuration(snapGuideMs, true)}</span></div>}
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
  const [libraryTabs, setLibraryTabs] = useState<LibraryTab[]>(initialTabs);
  const [activeMusicTabId, setActiveMusicTabId] = useState('music-1');
  const [activeVoiceTabId, setActiveVoiceTabId] = useState('voice-1');
  const [musicInsertion, setMusicInsertion] = useState<InsertionConfig>(defaultInsertion);
  const [voiceInsertion, setVoiceInsertion] = useState<InsertionConfig>(defaultInsertion);
  const [settings, setSettings] = useState(defaultSettings);
  const [audioSettings, setAudioSettings] = useState(defaultAudioSettings);
  const [arrangement, setArrangement] = useState<Arrangement | null>(null);
  const [automation, setAutomation] = useState<AutomationState | null>(null);
  const [editingPreferences, setEditingPreferences] = useState(defaultEditingPreferences);
  const [highlightedAssetIds, setHighlightedAssetIds] = useState<Set<string>>(new Set());
  const [activePreview, setActivePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string | undefined>();
  const [projectName, setProjectName] = useState('Proyecto sin título');
  const [exportOpen, setExportOpen] = useState(false);
  const [quarantine, setQuarantine] = useState<QuarantineItem[]>([]);
  const [importLogs, setImportLogs] = useState<ImportLog[]>([]);
  const [quarantineOpen, setQuarantineOpen] = useState(false);
  const [importLogOpen, setImportLogOpen] = useState(false);
  const [importProgress, setImportProgress] = useState<{ completed: number; total: number } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const allAssets = useMemo(() => [...music, ...voices], [music, voices]);
  const assetsRef = useRef<MediaAsset[]>([]);
  assetsRef.current = allAssets;
  const player = useTimelinePlayer(arrangement, allAssets, audioSettings, automation, libraryTabs);
  const occurrences = useMemo(() => {
    const counts = new Map<string, number>();
    if (!arrangement) return counts;
    [...arrangement.music, ...arrangement.voice].forEach(clip => {
      if (clip.assetId) counts.set(clip.assetId, (counts.get(clip.assetId) ?? 0) + 1);
    });
    return counts;
  }, [arrangement]);

  useEffect(() => () => {
    audio.current?.pause();
    assetsRef.current.forEach(asset => URL.revokeObjectURL(asset.previewUrl));
  }, []); // URLs are intentionally cleaned only when the app closes.

  useEffect(() => window.francisDesktop?.onImportProgress(setImportProgress), []);

  const status = useMemo(() => arrangement ? formatDuration(arrangement.durationMs) : t('projectReady'), [arrangement, t]);

  const addFiles = async (files: File[], kind: MediaKind, tabId: string) => {
    if (!files.length) return;
    setError(null);
    try {
      let assets: MediaAsset[];
      if (window.francisDesktop) {
        const inputPaths = files.map(file => window.francisDesktop!.getPathForFile(file)).filter(Boolean);
        setImportProgress({ completed: 0, total: inputPaths.length });
        const result = await window.francisDesktop.importPaths({ inputPaths, kind, tabId,
          verifyIntegrity: editingPreferences.verifyFileIntegrity,
          knownFingerprints: [...allAssets.map(asset => asset.fingerprint), ...quarantine.map(item => item.fingerprint)].filter(Boolean),
          knownFiles: [...allAssets, ...quarantine].map(item => ({ path: item.path, sizeBytes: item.sizeBytes })) });
        let destinationTabId = tabId;
        const existing = allAssets.some(asset => asset.libraryTabId === tabId);
        if (result.folderImport && existing) {
          destinationTabId = `${kind}-${crypto.randomUUID()}`;
          const sameKind = libraryTabs.filter(tab => tab.kind === kind);
          setLibraryTabs(current => [...current, { id: destinationTabId, kind, name: result.suggestedName,
            color: tabColors[sameKind.length % tabColors.length], localAutomationEnabled: false, automationPoints: [] }]);
          if (kind === 'music') setActiveMusicTabId(destinationTabId); else setActiveVoiceTabId(destinationTabId);
        }
        assets = result.assets.map((asset: MediaAsset) => ({ ...asset, libraryTabId: destinationTabId,
          color: tabColors[Math.abs(asset.name.length) % tabColors.length] }));
        setQuarantine(current => [...current, ...result.quarantined]);
        setImportLogs(current => [result.log, ...current]);
        const tab = libraryTabs.find(item => item.id === tabId);
        if (!existing && tab && /^(Música|Music|Locuciones|Voice spots?)\s+\d+$/i.test(tab.name)) updateLibraryTab(tabId, { name: result.suggestedName });
        if (result.quarantined.length) setQuarantineOpen(true);
      } else assets = await filesToAssets(files, kind, tabId);
      if (kind === 'music') setMusic(current => [...current, ...assets]);
      else setVoices(current => [...current, ...assets]);
      setArrangement(null);
      setAutomation(null);
    } catch {
      setError(t('fileError'));
    } finally {
      setImportProgress(null);
    }
  };

  const removeAsset = (id: string) => {
    const asset = allAssets.find(item => item.id === id);
    if (asset) URL.revokeObjectURL(asset.previewUrl);
    setMusic(current => current.filter(item => item.id !== id));
    setVoices(current => current.filter(item => item.id !== id));
    setArrangement(null);
    setAutomation(null);
    setHighlightedAssetIds(current => { const next = new Set(current); next.delete(id); return next; });
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
    const musicTabs = libraryTabs.filter(tab => tab.kind === 'music');
    const voiceTabs = libraryTabs.filter(tab => tab.kind === 'voice');
    const musicSequence = createInsertionSequence(musicTabs, music, activeMusicTabId, musicInsertion, settings.seed);
    const voiceSequence = createInsertionSequence(voiceTabs, voices, activeVoiceTabId, voiceInsertion, settings.seed + 10_000);
    const next = createArrangement(musicSequence, voiceSequence, settings);
    setArrangement(next);
    setAutomation(createAutomationState(next, audioSettings));
  };

  const moveClip = (clipId: string, kind: TimelineClip['kind'], startMs: number, _guideMs: number | null) => {
    if (!arrangement || kind === 'missing') return;
    player.pause();
    setArrangement(current => {
      if (!current) return current;
      if (kind === 'music') {
        const moved = current.music.filter(clip => clip.kind === 'music').map(clip => clip.id === clipId ? {
          ...clip, startMs, manuallyPositioned: Math.abs(startMs - clip.generatedStartMs) > 1
        } : clip);
        return { ...current, music: rebuildMissingMusic(moved, current.durationMs) };
      }
      return { ...current, voice: current.voice.map(clip => clip.id === clipId ? {
        ...clip, startMs, manuallyPositioned: Math.abs(startMs - clip.generatedStartMs) > 1
      } : clip).sort((a, b) => a.startMs - b.startMs) };
    });
  };

  const removeClip = (clip: TimelineClip) => {
    player.stop();
    setArrangement(current => {
      if (!current) return current;
      if (clip.kind === 'music') return {
        ...current,
        music: rebuildMissingMusic(current.music.filter(item => item.id !== clip.id), current.durationMs)
      };
      if (clip.kind === 'voice') return { ...current, voice: current.voice.filter(item => item.id !== clip.id) };
      return current;
    });
    if (clip.kind === 'voice') setAutomation(current => current ? removeAutomationAssignment(current, clip.id) : current);
  };

  const changeClipFade = (clipId: string, kind: TimelineClip['kind'], edge: 'in' | 'out', durationMs: number) => {
    if (kind === 'missing') return;
    setArrangement(current => {
      if (!current) return current;
      const key = kind === 'music' ? 'music' : 'voice';
      return { ...current, [key]: current[key].map(clip => clip.id === clipId
        ? { ...clip, [edge === 'in' ? 'fadeInMs' : 'fadeOutMs']: Math.round(durationMs) } : clip) };
    });
  };

  const dropAsset = (assetId: string, kind: MediaKind, proposedStartMs: number) => {
    if (!arrangement) return;
    if (!editingPreferences.allowAssetReuse && (occurrences.get(assetId) ?? 0) > 0) return;
    const asset = allAssets.find(item => item.id === assetId && item.kind === kind);
    if (!asset) return;
    const durationMs = Math.min(asset.durationMs, arrangement.durationMs);
    const draft: TimelineClip = {
      id: `clip-${asset.id}-${crypto.randomUUID()}`,
      assetId: asset.id, kind, name: asset.name, startMs: proposedStartMs, generatedStartMs: proposedStartMs,
      durationMs, sourceDurationMs: asset.durationMs, color: asset.color, manuallyPositioned: true,
      libraryTabId: asset.libraryTabId
    };
    const snapped = editingPreferences.snapEnabled ? snapClipStart({
      proposedStartMs, clip: draft, arrangement, mode: editingPreferences.snapMode,
      gridMs: editingPreferences.snapGridMs, toleranceMs: 750
    }).startMs : Math.max(0, Math.min(arrangement.durationMs - durationMs, proposedStartMs));
    const clip = { ...draft, startMs: snapped, generatedStartMs: snapped };
    setArrangement(current => {
      if (!current) return current;
      if (kind === 'music') return { ...current, music: rebuildMissingMusic([...current.music, clip], current.durationMs) };
      return { ...current, voice: [...current.voice, clip].sort((a, b) => a.startMs - b.startMs) };
    });
    if (kind === 'voice') setAutomation(current => current ? addAutomationAssignment(current, clip.id) : current);
  };

  const addLibraryTab = (kind: MediaKind) => {
    const sameKind = libraryTabs.filter(tab => tab.kind === kind);
    const id = `${kind}-${crypto.randomUUID()}`;
    const tab: LibraryTab = {
      id, kind, name: `${t(kind === 'music' ? 'music' : 'voices')} ${sameKind.length + 1}`,
      color: tabColors[sameKind.length % tabColors.length], localAutomationEnabled: false, automationPoints: []
    };
    setLibraryTabs(current => [...current, tab]);
    if (kind === 'music') setActiveMusicTabId(id); else setActiveVoiceTabId(id);
  };

  const updateLibraryTab = (id: string, patch: Partial<LibraryTab>) => {
    setLibraryTabs(current => current.map(tab => tab.id === id ? { ...tab, ...patch } : tab));
  };

  const moveLibraryTab = (id: string, direction: -1 | 1) => {
    setLibraryTabs(current => {
      const tab = current.find(item => item.id === id);
      if (!tab) return current;
      const kindTabs = current.filter(item => item.kind === tab.kind);
      const index = kindTabs.findIndex(item => item.id === id);
      const swap = kindTabs[index + direction];
      if (!swap) return current;
      const first = current.findIndex(item => item.id === id);
      const second = current.findIndex(item => item.id === swap.id);
      const next = [...current];
      [next[first], next[second]] = [next[second], next[first]];
      return next;
    });
  };

  const removeLibraryTab = (id: string) => {
    const tab = libraryTabs.find(item => item.id === id);
    if (!tab || libraryTabs.filter(item => item.kind === tab.kind).length <= 1) return;
    const removedAssets = allAssets.filter(asset => asset.libraryTabId === id);
    removedAssets.forEach(asset => URL.revokeObjectURL(asset.previewUrl));
    if (tab.kind === 'music') setMusic(current => current.filter(asset => asset.libraryTabId !== id));
    else setVoices(current => current.filter(asset => asset.libraryTabId !== id));
    const remaining = libraryTabs.filter(item => item.kind === tab.kind && item.id !== id);
    setLibraryTabs(current => current.filter(item => item.id !== id));
    if (tab.kind === 'music') setActiveMusicTabId(remaining[0].id); else setActiveVoiceTabId(remaining[0].id);
    setArrangement(null); setAutomation(null);
  };

  const projectDocument = (): ProjectDocument => ({
    name: projectName, version: '0.9.0', settings, audioSettings, editingPreferences, libraryTabs,
    activeMusicTabId, activeVoiceTabId, musicInsertion, voiceInsertion, arrangement, automation, assets: allAssets,
    quarantine, importLogs
  });

  const saveProject = async (saveAs = false) => {
    if (!window.francisDesktop) return;
    try {
      const savedPath = await window.francisDesktop.saveProject(projectDocument(), saveAs ? undefined : projectPath);
      if (savedPath) {
        setProjectPath(savedPath);
        const fileName = savedPath.split(/[\\/]/).pop()?.replace(/\.francis$/i, '');
        if (fileName) setProjectName(fileName);
      }
    } catch {
      setError(t('projectSaveError'));
    }
  };

  const openProject = async (requestedPath?: string) => {
    if (!window.francisDesktop) return;
    try {
      const opened = await window.francisDesktop.openProject(requestedPath);
      if (!opened) return;
      const project = opened.project as ProjectDocument;
      player.stop(); audio.current?.pause();
      assetsRef.current.filter(asset => asset.previewUrl.startsWith('blob:')).forEach(asset => URL.revokeObjectURL(asset.previewUrl));
      setMusic(project.assets.filter(asset => asset.kind === 'music'));
      setVoices(project.assets.filter(asset => asset.kind === 'voice'));
      setSettings(project.settings); setAudioSettings(project.audioSettings); setEditingPreferences({ ...defaultEditingPreferences, ...project.editingPreferences });
      setLibraryTabs(project.libraryTabs); setActiveMusicTabId(project.activeMusicTabId); setActiveVoiceTabId(project.activeVoiceTabId);
      setMusicInsertion(project.musicInsertion); setVoiceInsertion(project.voiceInsertion);
      setArrangement(project.arrangement); setAutomation(project.automation);
      setQuarantine(project.quarantine ?? []); setImportLogs(project.importLogs ?? []);
      setHighlightedAssetIds(new Set()); setProjectPath(opened.projectPath); setProjectName(project.name);
    } catch {
      setError(t('projectOpenError'));
    }
  };

  const newProject = () => {
    player.stop(); audio.current?.pause();
    assetsRef.current.filter(asset => asset.previewUrl.startsWith('blob:')).forEach(asset => URL.revokeObjectURL(asset.previewUrl));
    setMusic([]); setVoices([]); setLibraryTabs(initialTabs.map(tab => ({ ...tab, automationPoints: [] })));
    setActiveMusicTabId('music-1'); setActiveVoiceTabId('voice-1'); setArrangement(null); setAutomation(null);
    setHighlightedAssetIds(new Set()); setQuarantine([]); setImportLogs([]); setProjectPath(undefined); setProjectName(t('untitledProject'));
  };

  const exportAudio = async (exportSettings: ExportSettings) => {
    if (!window.francisDesktop || !arrangement) return null;
    return window.francisDesktop.exportAudio(projectDocument(), exportSettings);
  };

  const admitFromQuarantine = (item: QuarantineItem) => {
    const libraryTabId = item.kind === 'music' ? activeMusicTabId : activeVoiceTabId;
    const asset: MediaAsset = {
      id: `${item.kind}-${crypto.randomUUID()}`, kind: item.kind, name: item.name.replace(/\.[^/.]+$/, ''),
      durationMs: item.durationMs, sizeBytes: item.sizeBytes, path: item.path, previewUrl: item.previewUrl,
      color: tabColors[item.name.length % tabColors.length], libraryTabId, waveform: [], fingerprint: item.fingerprint, integrity: 'warning'
    };
    if (item.kind === 'music') setMusic(current => [...current, asset]); else setVoices(current => [...current, asset]);
    setQuarantine(current => current.filter(candidate => candidate.id !== item.id));
    setImportLogs(current => [{
      id: crypto.randomUUID(), startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), sourceCount: 1,
      importedCount: 1, quarantinedCount: 0, duplicateCount: 0,
      entries: [{ path: item.path, name: item.name, outcome: 'imported', detail: 'Manually admitted from quarantine' }]
    }, ...current]);
    setArrangement(null); setAutomation(null);
  };

  useEffect(() => {
    const removeListener = window.francisDesktop?.onOpenProject(path => { void openProject(path); });
    const keyboard = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void saveProject(event.shiftKey); }
      if (event.key.toLowerCase() === 'o') { event.preventDefault(); void openProject(); }
    };
    window.addEventListener('keydown', keyboard);
    return () => { removeListener?.(); window.removeEventListener('keydown', keyboard); };
  });

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><BrandMark /><div><h1>Francis Player</h1><p>{t('appSubtitle')}</p></div></div>
      <div className="project-state"><span className="draft-pill">{projectPath ? t('statusSaved') : t('statusDraft')}</span><div><strong>{projectName}</strong><small>{status}</small></div></div>
      <nav className="project-actions">
        <button onClick={newProject} title={t('newProjectAction')}>＋</button>
        <button onClick={() => void openProject()} title={`${t('openProject')} · Ctrl/⌘O`}>⌂</button>
        <button onClick={() => void saveProject(false)} title={`${t('saveProject')} · Ctrl/⌘S`}>▣</button>
        <button onClick={() => void saveProject(true)} title={t('saveProjectAs')}>▣＋</button>
        <button className={quarantine.length ? 'attention' : ''} onClick={() => setQuarantineOpen(true)} title={t('quarantine')}>Q {quarantine.length}</button>
        <button onClick={() => setImportLogOpen(true)} title={t('importLog')}>☷ {importLogs.length}</button>
        <button className="export-nav" onClick={() => setExportOpen(true)} disabled={!arrangement} title={t('exportMix')}>{t('export')}</button>
      </nav>
      <div className="language-switch" aria-label={t('language')}>
        <button className={i18n.language === 'es' ? 'active' : ''} onClick={() => void i18n.changeLanguage('es')}>{t('spanish')}</button>
        <button className={i18n.language === 'en' ? 'active' : ''} onClick={() => void i18n.changeLanguage('en')}>{t('english')}</button>
      </div>
    </header>

    <main>
      {error && <div className="error-banner">{error}<button onClick={() => setError(null)}>×</button></div>}
      <div className="workspace-grid">
        <div className="library-area">
          <AssetList kind="music" assets={music} tabs={libraryTabs.filter(tab => tab.kind === 'music')}
            activeTabId={activeMusicTabId} insertion={musicInsertion} activePreview={activePreview} occurrences={occurrences}
            highlightedAssetIds={highlightedAssetIds} allowAssetReuse={editingPreferences.allowAssetReuse} onFiles={addFiles}
            onRemove={removeAsset} onPreview={preview} onToggleHighlight={(id) => setHighlightedAssetIds(current => {
              const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
            })} onSelectTab={setActiveMusicTabId} onAddTab={addLibraryTab}
            onRenameTab={(id, name) => updateLibraryTab(id, { name })} onMoveTab={moveLibraryTab} onRemoveTab={removeLibraryTab}
            onToggleLocalAutomation={(id) => {
              const tab = libraryTabs.find(item => item.id === id);
              updateLibraryTab(id, { localAutomationEnabled: !tab?.localAutomationEnabled,
                automationPoints: tab?.automationPoints.length ? tab.automationPoints : [
                  { id: crypto.randomUUID(), position: 0, value: 100 }, { id: crypto.randomUUID(), position: 1, value: 100 }
                ] });
            }}
            onInsertionChange={(patch) => setMusicInsertion(current => ({ ...current, ...patch }))} />
          <AssetList kind="voice" assets={voices} tabs={libraryTabs.filter(tab => tab.kind === 'voice')}
            activeTabId={activeVoiceTabId} insertion={voiceInsertion} activePreview={activePreview} occurrences={occurrences}
            highlightedAssetIds={highlightedAssetIds} allowAssetReuse={editingPreferences.allowAssetReuse} onFiles={addFiles}
            onRemove={removeAsset} onPreview={preview} onToggleHighlight={(id) => setHighlightedAssetIds(current => {
              const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
            })} onSelectTab={setActiveVoiceTabId} onAddTab={addLibraryTab}
            onRenameTab={(id, name) => updateLibraryTab(id, { name })} onMoveTab={moveLibraryTab} onRemoveTab={removeLibraryTab}
            onToggleLocalAutomation={(id) => {
              const tab = libraryTabs.find(item => item.id === id);
              updateLibraryTab(id, { localAutomationEnabled: !tab?.localAutomationEnabled,
                automationPoints: tab?.automationPoints.length ? tab.automationPoints : [
                  { id: crypto.randomUUID(), position: 0, value: 100 }, { id: crypto.randomUUID(), position: 1, value: 100 }
                ] });
            }}
            onInsertionChange={(patch) => setVoiceInsertion(current => ({ ...current, ...patch }))} />
        </div>
        <SettingsPanel settings={settings} audioSettings={audioSettings} automation={automation} editingPreferences={editingPreferences} mounted={Boolean(arrangement)}
          canMount={music.length + voices.length > 0}
          onChange={(patch) => { player.stop(); setSettings(current => ({ ...current, ...patch })); setArrangement(null); setAutomation(null); }}
          onAudioChange={(patch) => {
            setAudioSettings(current => ({ ...current, ...patch }));
            setAutomation(current => current ? syncDefaultAutomationGroups(current, patch) : current);
          }}
          onAutomationChange={setAutomation}
          onEditingPreferencesChange={(patch) => setEditingPreferences(current => ({ ...current, ...patch }))}
          onMount={mount} />
      </div>
      <Timeline arrangement={arrangement} tabs={libraryTabs} assets={allAssets} isPlaying={player.isPlaying} positionMs={player.positionMs}
        musicGainDb={player.musicGainDb} automation={automation} editingPreferences={editingPreferences}
        highlightedAssetIds={highlightedAssetIds} onAutomationChange={setAutomation}
        onEditingPreferencesChange={(patch) => setEditingPreferences(current => ({ ...current, ...patch }))}
        onMoveClip={moveClip} onRemoveClip={removeClip} onFadeChange={changeClipFade} onTabChange={updateLibraryTab} onDropAsset={dropAsset}
        onPlay={() => { audio.current?.pause(); setActivePreview(null); player.play(); }}
        onPause={player.pause} onStop={player.stop} onSeek={player.seek} />
    </main>
    <ExportDialog open={exportOpen} canExport={Boolean(arrangement && allAssets.length)} onClose={() => setExportOpen(false)} onExport={exportAudio} />
    <QuarantineDialog open={quarantineOpen} items={quarantine} onClose={() => setQuarantineOpen(false)} onAdmit={admitFromQuarantine} />
    <ImportLogDialog open={importLogOpen} logs={importLogs} onClose={() => setImportLogOpen(false)} />
    {importProgress && <div className="import-progress-toast"><strong>{t('analyzingFiles')}</strong>
      <span>{importProgress.completed} / {importProgress.total}</span><i><b style={{ width: `${importProgress.total ? importProgress.completed / importProgress.total * 100 : 0}%` }} /></i></div>}
  </div>;
}
