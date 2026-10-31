import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ChangeEvent } from 'react';
import { allocateClipLanes, createArrangement, durationToIncludeAllMusic, intervalForVoiceDuration, preserveManualVoicePositions, rebuildMissingMusic, rippleMoveMusicClip, shuffleWithSeed, voiceScheduleDuration } from './lib/arrangement';
import { addAutomationAssignment, createAutomationState, reconcileAutomationAssignments, syncDefaultAutomationGroups } from './lib/automation';
import { formatBytes, formatDuration } from './lib/format';
import { filesToAssets } from './lib/media';
import { useTimelinePlayer } from './hooks/useTimelinePlayer';
import { AutomationEditor } from './components/AutomationEditor';
import { TrackAutomationLane } from './components/TrackAutomationLane';
import { ExportDialog } from './components/ExportDialog';
import { ImportLogDialog, QuarantineDialog } from './components/ImportCenterDialog';
import { MixDuckingGraph } from './components/MixDuckingGraph';
import { snapClipStart } from './lib/snapping';
import { createInsertionSequence } from './lib/insertion';
import { overlappingClipIds } from './lib/overlaps';
import { normalizationAdjustmentDb } from './lib/audio';
import { anchoredScrollLeft, fitTimelineZoom, zoomFromPinch } from './lib/timelineZoom';
import appIconUrl from '../assets/icon.svg';
import type { Arrangement, ArrangementSettings, AudioSettings, AutomationState, EditingPreferences, ExportSettings, ImportLog, InsertionConfig, LibraryTab, LoudnessMeterReading, MediaAsset, MediaKind, QuarantineItem, TimelineClip } from './types';

const defaultSettings: ArrangementSettings = {
  targetDurationMs: 74 * 60_000,
  durationFromVoices: false,
  musicOrder: 'sequential',
  voiceOrder: 'sequential',
  repeatMusic: true,
  musicFillMode: 'random',
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
  fadeUpMs: 2000,
  fadeDownOverlapMs: 0,
  fadeUpOverlapMs: 0,
  normalizeClips: false,
  normalizationTargetLufs: -23,
  truePeakCeilingDbtp: -1,
  echoEnabled: false,
  echoDelayMs: 260,
  echoFeedback: 30,
  echoMix: 15,
  reverbEnabled: false,
  reverbDuration: 1.8,
  reverbDecay: 2.4,
  reverbMix: 15
};

const defaultEditingPreferences: EditingPreferences = {
  snapEnabled: true,
  snapMode: 'smart',
  snapGridMs: 1000,
  transportSkipSeconds: 10,
  allowAssetReuse: true,
  verifyFileIntegrity: true,
  analyzeLoudnessOnImport: true,
  showFileLoudness: true,
  automationDisplayUnit: 'percent',
  showAutomations: true,
  mixEditorMode: 'values',
  trimSilenceEnabled: true,
  trimSilenceThresholdDb: -30,
  trimSilencePaddingMs: 80,
  trimSilenceMinimumMs: 120
};

const acceptAudio = '.mp3,.wav,.wave,.m4a,.aac,.flac,.ogg,.oga,.opus,.aif,.aiff,.wma,audio/*';
const tabColors = ['#4f8cff', '#de6ea8', '#4eb6a1', '#d4a63d', '#9b72cf', '#e77d50'];
const initialTabs: LibraryTab[] = [
  { id: 'music-1', kind: 'music', name: 'Música 1', color: '#4f8cff', localAutomationEnabled: false, automationPoints: [] },
  { id: 'voice-1', kind: 'voice', name: 'Locuciones 1', color: '#de6ea8', localAutomationEnabled: false, automationPoints: [] }
];
const defaultMusicInsertion: InsertionConfig = { mode: 'balanced', customPattern: '1, 2, 1, 3' };
const defaultVoiceInsertion: InsertionConfig = { mode: 'balanced', customPattern: '1, 2, 1, 3' };

function InfoHint({ text }: { text: string }) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const show = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ left: Math.max(12, Math.min(window.innerWidth - 292, rect.left + rect.width / 2 - 140)),
      top: Math.max(12, Math.min(window.innerHeight - 180, rect.bottom + 8)) });
  };
  return <><span ref={ref} className="info-hint" role="button" tabIndex={0} aria-describedby={position ? id : undefined}
    onMouseEnter={show} onMouseLeave={() => setPosition(null)} onFocus={show} onBlur={() => setPosition(null)}
    onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
    onClick={(event) => { event.preventDefault(); event.stopPropagation(); show(); }}
    onKeyDown={(event) => { if (event.key === 'Escape') setPosition(null); }}>i</span>
    {position && createPortal(<div id={id} className="info-tooltip" role="tooltip" style={position}>{text}</div>, document.body)}</>;
}

function FieldLabel({ children, help }: { children: React.ReactNode; help?: string }) {
  return <span className="field-label">{children}{help && <InfoHint text={help} />}</span>;
}

interface ProjectSnapshot {
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

interface ProjectDocument extends ProjectSnapshot {
  history?: { entries: ProjectSnapshot[]; index: number };
}

const snapshotSignature = (snapshot: ProjectSnapshot) => JSON.stringify({
  ...snapshot,
  name: undefined,
  assets: snapshot.assets.map(({ path: _path, previewUrl: _previewUrl, waveform: _waveform, ...asset }) => asset),
  quarantine: snapshot.quarantine.map(({ path: _path, previewUrl: _previewUrl, ...item }) => item)
});

const applySilenceBounds = (assets: MediaAsset[], results: Array<{
  path: string; trimStartMs: number; trimEndMs: number; trimmed: boolean;
}>) => {
  const byPath = new Map(results.map(result => [result.path, result]));
  return assets.map(asset => {
    const result = byPath.get(asset.path);
    if (!result) return asset;
    const sourceDurationMs = asset.sourceDurationMs ?? asset.durationMs;
    if (!result.trimmed) {
      const { sourceDurationMs: _sourceDurationMs, trimStartMs: _trimStartMs, trimEndMs: _trimEndMs, ...rest } = asset;
      return { ...rest, durationMs: sourceDurationMs };
    }
    return { ...asset, sourceDurationMs, trimStartMs: result.trimStartMs, trimEndMs: result.trimEndMs,
      durationMs: Math.max(100, result.trimEndMs - result.trimStartMs) };
  });
};

function BrandMark() {
  return <img className="brand-mark" src={appIconUrl} alt="" aria-hidden="true" />;
}

function ProjectActionIcon({ type }: { type: 'new' | 'open' | 'save' | 'saveAs' }) {
  if (type === 'new') return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 3.5h8l4 4V20.5H6z" /><path d="M14 3.5v4h4M9 14h6M12 11v6" />
  </svg>;
  if (type === 'open') return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3.5 7.5h6l2-2h4l2 2h3v11h-17z" /><path d="M3.5 10h17l-2 8.5h-17z" />
  </svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 3.5h13l3 3v14H4z" /><path d="M8 3.5v6h8v-6M8 20.5v-7h8v7" />
    {type === 'saveAs' && <path className="icon-accent" d="M17.5 12v6M14.5 15h6" />}
  </svg>;
}

interface AssetListProps {
  kind: MediaKind;
  assets: MediaAsset[];
  tabs: LibraryTab[];
  activeTabId: string;
  insertion: InsertionConfig;
  activePreview: string | null;
  occurrences: Map<string, number>;
  allowAssetReuse: boolean;
  showFileLoudness: boolean;
  audioSettings: AudioSettings;
  onFiles: (files: File[], kind: MediaKind, tabId: string) => void;
  onRemove: (id: string) => void;
  onRestoreTrim: (id: string) => void;
  onPreview: (asset: MediaAsset) => void;
  onAddAll: () => void;
  onSelectTab: (id: string) => void;
  onAddTab: (kind: MediaKind) => void;
  onRenameTab: (id: string, name: string) => void;
  onMoveTab: (id: string, direction: -1 | 1) => void;
  onRemoveTab: (id: string) => void;
  onToggleLocalAutomation: (id: string) => void;
  onInsertionChange: (patch: Partial<InsertionConfig>) => void;
}

function AssetList({ kind, assets, tabs, activeTabId, insertion, activePreview, occurrences, allowAssetReuse, showFileLoudness, audioSettings,
  onFiles, onRemove, onRestoreTrim, onPreview, onAddAll, onSelectTab, onAddTab, onRenameTab, onMoveTab, onRemoveTab,
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
    </button><button className="folder-button" onClick={() => folderInput.current?.click()} title={t('addFolder')}>
      <span aria-hidden="true">▰</span><b>{t('folder')}</b>
    </button></div>
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
        const used = occurrenceCount > 0;
        return <article className={`asset-row ${locked ? 'asset-locked' : ''} ${used ? 'asset-highlighted' : ''}`} key={asset.id}
          draggable={!locked} onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData('application/x-francis-asset', JSON.stringify({ assetId: asset.id, kind: asset.kind }));
          }}>
        <button className={`preview-button ${activePreview === asset.id ? 'active' : ''}`} draggable={false}
          onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onPreview(asset); }}
          title={t('previewFile')}
          aria-label={t(activePreview === asset.id ? 'pause' : 'play')}>
          {activePreview === asset.id ? '■' : '▶'}
        </button>
        <div className="asset-index">{String(index + 1).padStart(2, '0')}</div>
        <div className="asset-info">
          <strong title={asset.name}>{asset.name}</strong>
          <span>{asset.durationMs ? formatDuration(asset.durationMs) : '—'} · {formatBytes(asset.sizeBytes, i18n.language)}
            {asset.sourceDurationMs !== undefined && asset.durationMs < asset.sourceDurationMs && <b className="trim-indicator" title={t('trimmedAudio')}> · ✂</b>}
            {asset.integrity === 'warning' && <b className="integrity-warning" title={t('admittedWithWarning')}> · !</b>}</span>
          {showFileLoudness && asset.analysis && (() => { const gain = normalizationAdjustmentDb(asset.analysis, audioSettings); return <span className="file-loudness" title={t('fileLoudnessDetail')}>
            {asset.analysis.integratedLufs.toFixed(1)} LUFS · {asset.analysis.truePeakDbtp.toFixed(1)} dBTP · {gain >= 0 ? '+' : ''}{gain.toFixed(1)} dB
          </span>; })()}
        </div>
        <span className={`occurrence-badge ${occurrenceCount > 0 ? 'used' : ''}`} title={t('timelineOccurrences', { count: occurrenceCount })}>{occurrenceCount}</span>
        <span className={`highlight-button ${used ? 'active' : ''}`} role="status"
          title={t(used ? 'assetOnTimeline' : 'assetNotOnTimeline')}
          aria-label={t(used ? 'assetOnTimeline' : 'assetNotOnTimeline')}>◉</span>
        {asset.sourceDurationMs !== undefined && <button className="restore-trim-button" onClick={() => onRestoreTrim(asset.id)}
          title={t('restoreThisTrim')} aria-label={t('restoreThisTrim')}>↔</button>}
        <button className="remove-button" onClick={() => onRemove(asset.id)} aria-label={t('remove')}>×</button>
      </article>;})}
    </div>

    <div className="insertion-logic">
      <label><FieldLabel help={t('insertionLogicHelp')}>{t('insertionLogic')}</FieldLabel><select value={insertion.mode}
        onChange={(event) => onInsertionChange({ mode: event.target.value as InsertionConfig['mode'], userSelected: true })}>
        <option value="balanced">{t('insertBalanced')}</option><option value="active">{t('insertActive')}</option><option value="all">{t('insertAll')}</option>
        <option value="roundRobin">{t('insertRoundRobin')}</option><option value="random">{t('insertRandom')}</option>
        <option value="custom">{t('insertCustom')}</option>
      </select></label>
      {insertion.mode === 'custom' && <input value={insertion.customPattern}
        onChange={(event) => onInsertionChange({ customPattern: event.target.value, userSelected: true })} placeholder="1, 2, 1, 3" />}
      <button className="add-all-button" onClick={onAddAll} disabled={assets.length === 0}>{t('addAllToTimeline')}</button>
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
  voiceAssets: MediaAsset[];
  onChange: (patch: Partial<ArrangementSettings>) => void;
  onAudioChange: (patch: Partial<AudioSettings>) => void;
  onAutomationChange: (state: AutomationState) => void;
  onEditingPreferencesChange: (patch: Partial<EditingPreferences>) => void;
  trimmingVoices: boolean;
  onTrimVoices: () => void;
  onRestoreVoiceTrims: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

function SettingsPanel({ settings, audioSettings, automation, editingPreferences, voiceAssets, onChange, onAudioChange, onAutomationChange,
  onEditingPreferencesChange, trimmingVoices, onTrimVoices, onRestoreVoiceTrims, collapsed, onToggleCollapsed }: SettingsPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'arrangement' | 'audio' | 'automation' | 'editing'>('arrangement');
  const targetMinutes = Math.round(settings.targetDurationMs / 60_000);
  const intervalSeconds = Math.round(settings.voiceIntervalMs / 1000);
  const targetSliderMax = Math.max(360, Math.ceil(voiceScheduleDuration(voiceAssets, 300_000, settings.allowVoiceOverlap) / 60_000));
  const changeTarget = (targetDurationMs: number) => onChange({
    targetDurationMs,
    voiceIntervalMs: intervalForVoiceDuration(voiceAssets, targetDurationMs, settings.allowVoiceOverlap)
  });
  const changeInterval = (voiceIntervalMs: number) => onChange({
    voiceIntervalMs,
    targetDurationMs: voiceAssets.length
      ? voiceScheduleDuration(voiceAssets, voiceIntervalMs, settings.allowVoiceOverlap)
      : settings.targetDurationMs
  });

  return <aside className={`settings-panel ${collapsed ? 'collapsed' : ''}`}>
    <div className="panel-heading settings-title">
      <div><h2>{t('setup')}</h2></div>
      <button className="settings-collapse-button" onClick={onToggleCollapsed} aria-expanded={!collapsed}
        aria-label={t(collapsed ? 'expandSettings' : 'collapseSettings')} title={t(collapsed ? 'expandSettings' : 'collapseSettings')}>
        {collapsed ? '‹' : '›'}
      </button>
      {collapsed && <span className="collapsed-settings-label">{t('setup')}</span>}
    </div>

    <div className="settings-tabs">
      {(['arrangement', 'audio', 'automation', 'editing'] as const).map(item => <button key={item}
        className={tab === item ? 'active' : ''} title={t(`settingsTab_${item}Help`)} onClick={() => setTab(item)}>{t(`settingsTab_${item}`)}</button>)}
    </div>

    {tab === 'arrangement' && <div className="settings-grid">
      <label className="field full">
        <FieldLabel help={t('targetDurationHelp')}>{t('targetDuration')}</FieldLabel>
        <div className="linked-range"><input type="range" min="1" max={targetSliderMax} step="1" value={targetMinutes}
          onChange={(event) => changeTarget(Math.max(1, Math.round(Number(event.target.value))) * 60_000)} />
        <div className="number-field"><input type="number" min="1" max={targetSliderMax} step="1" value={targetMinutes}
          onChange={(event) => changeTarget(Math.max(1, Math.round(Number(event.target.value))) * 60_000)} />
          <em>{t('minutes')}</em></div>
        </div>
      </label>

      <div className="settings-divider-row full">
        <Toggle label={t('durationFromVoices')} help={t('durationFromVoicesHelp')} checked={settings.durationFromVoices ?? false} onChange={(durationFromVoices) => onChange({
          durationFromVoices,
          ...(durationFromVoices ? { voicePlacement: 'interval' as const } : {}),
          ...(durationFromVoices && voiceAssets.length ? { targetDurationMs: voiceScheduleDuration(voiceAssets, settings.voiceIntervalMs, settings.allowVoiceOverlap) } : {})
        })} />
      </div>

      <Segmented label={t('musicOrder')} help={t('musicOrderHelp')} value={settings.musicOrder} options={[
        ['sequential', t('sequential')], ['random', t('random')]
      ]} onChange={(value) => onChange({ musicOrder: value as ArrangementSettings['musicOrder'] })} />

      <Segmented label={t('voiceOrder')} help={t('voiceOrderHelp')} value={settings.voiceOrder} options={[
        ['sequential', t('sequential')], ['random', t('random')]
      ]} onChange={(value) => onChange({ voiceOrder: value as ArrangementSettings['voiceOrder'] })} />

      <Segmented label={t('musicFill')} help={t('musicFillHelp')} value={settings.musicFillMode ?? (settings.repeatMusic ? 'repeat' : 'silence')} full options={[
        ['silence', t('doNotFill')], ['repeat', t('fillRepeating')], ['random', t('fillRandom')]
      ]} onChange={(value) => onChange({ musicFillMode: value as NonNullable<ArrangementSettings['musicFillMode']>, repeatMusic: value !== 'silence' })} />

      <Segmented label={t('voicePlacement')} help={t('voicePlacementHelp')} value={settings.voicePlacement} full options={[
        ['interval', t('interval')], ['uniform', t('uniform')]
      ]} onChange={(value) => onChange({ voicePlacement: value as ArrangementSettings['voicePlacement'] })} />

      {settings.voicePlacement === 'interval' && <label className="field full">
        <FieldLabel help={t('intervalSecondsHelp')}>{t('intervalSeconds')}</FieldLabel>
        <div className="linked-range"><input type="range" min="0" max="300" step="1" value={intervalSeconds}
          onChange={(event) => changeInterval(Math.max(0, Math.round(Number(event.target.value))) * 1000)} />
        <div className="number-field"><input type="number" min="0" max="300" step="1" value={intervalSeconds}
          onChange={(event) => changeInterval(Math.max(0, Math.round(Number(event.target.value))) * 1000)} />
          <em>{t('seconds')}</em></div>
        </div>
      </label>}

      <Toggle label={t('allowOverlap')} help={t('allowOverlapHelp')} checked={settings.allowVoiceOverlap} onChange={(allowVoiceOverlap) => onChange({
        allowVoiceOverlap,
        ...(settings.durationFromVoices
          ? { targetDurationMs: voiceScheduleDuration(voiceAssets, settings.voiceIntervalMs, allowVoiceOverlap) }
          : { voiceIntervalMs: intervalForVoiceDuration(voiceAssets, settings.targetDurationMs, allowVoiceOverlap) })
      })} />

      <label className="field seed-field">
        <FieldLabel help={t('seedHelp')}>{t('seed')}</FieldLabel>
        <input type="number" value={settings.seed} onChange={(event) => onChange({ seed: Number(event.target.value) || 1 })} />
      </label>
      <div className="mount-priorities full">
        <strong><FieldLabel help={t('mountPrioritiesHelp')}>{t('mountPriorities')}</FieldLabel></strong>
        <ol><li>{t('priorityAllVoices')}</li><li>{t('priorityDuration')}</li><li>{t('priorityVoiceSpacing')}</li>
          <li>{t('priorityAllMusic')}</li><li>{t('priorityFillMusic')}</li></ol>
        <p>{t('priorityVoiceRule')}</p>
      </div>
    </div>}

    {tab === 'audio' && <div className="settings-tab-content"><div className="audio-settings-heading">
      <h3>{t('audioMix')}</h3>
      <div className="audio-mode-switch"><Segmented label={t('editMode')} help={t('editModeHelp')} value={editingPreferences.mixEditorMode} options={[
        ['values', t('valuesMode')], ['graphic', t('graphicMode')]
      ]} onChange={(value) => onEditingPreferencesChange({ mixEditorMode: value as EditingPreferences['mixEditorMode'] })} /></div>
    </div>
    {editingPreferences.mixEditorMode === 'values' ? <div className="audio-settings-grid mix-values-grid">
      <DbField label={t('musicLevel')} help={t('musicLevelHelp')} value={audioSettings.musicGainDb} onChange={(musicGainDb) => onAudioChange({ musicGainDb })} />
      <DbField label={t('voiceLevel')} help={t('voiceLevelHelp')} value={audioSettings.voiceGainDb} onChange={(voiceGainDb) => onAudioChange({ voiceGainDb })} />
      <DbField label={t('duckingLevel')} help={t('duckingLevelHelp')} value={audioSettings.duckingGainDb} min={-80} max={0} onChange={(duckingGainDb) => onAudioChange({ duckingGainDb })} />
      <MsField label={t('fadeDown')} help={t('fadeDownHelp')} value={audioSettings.fadeDownMs} onChange={(fadeDownMs) => onAudioChange({ fadeDownMs })} />
      <MsField label={t('fadeUp')} help={t('fadeUpHelp')} value={audioSettings.fadeUpMs} onChange={(fadeUpMs) => onAudioChange({ fadeUpMs })} />
      <MsField label={t('fadeDownOverlap')} help={t('fadeDownOverlapHelp')} value={audioSettings.fadeDownOverlapMs ?? 0}
        onChange={(fadeDownOverlapMs) => onAudioChange({ fadeDownOverlapMs: Math.min(fadeDownOverlapMs, audioSettings.fadeDownMs) })} />
      <MsField label={t('fadeUpOverlap')} help={t('fadeUpOverlapHelp')} value={audioSettings.fadeUpOverlapMs ?? 0}
        onChange={(fadeUpOverlapMs) => onAudioChange({ fadeUpOverlapMs: Math.min(fadeUpOverlapMs, audioSettings.fadeUpMs) })} />
    </div> : <MixDuckingGraph settings={audioSettings} onChange={onAudioChange} />}
    <div className="audio-processing-heading"><h3>{t('audioProcessing')}</h3></div>
    <div className="audio-settings-grid audio-processing-grid">
      <Toggle label={t('normalizeClips')} help={t('normalizeClipsHelp')} checked={audioSettings.normalizeClips ?? false}
        onChange={(normalizeClips) => onAudioChange({ normalizeClips })} />
      <DbField label={t('normalizationTarget')} help={t('normalizationTargetHelp')} value={audioSettings.normalizationTargetLufs ?? -23} min={-30} max={-5}
        onChange={(normalizationTargetLufs) => onAudioChange({ normalizationTargetLufs })} />
      <DbField label={t('truePeakCeiling')} help={t('truePeakCeilingHelp')} value={audioSettings.truePeakCeilingDbtp ?? -1} min={-9} max={0}
        onChange={(truePeakCeilingDbtp) => onAudioChange({ truePeakCeilingDbtp })} />
      <Toggle label={t('enableEcho')} help={t('enableEchoHelp')} checked={audioSettings.echoEnabled ?? false}
        onChange={(echoEnabled) => onAudioChange({ echoEnabled })} />
      <MsField label={t('echoDelay')} help={t('echoDelayHelp')} value={audioSettings.echoDelayMs ?? 260}
        onChange={(echoDelayMs) => onAudioChange({ echoDelayMs })} />
      <PercentField label={t('echoFeedback')} help={t('echoFeedbackHelp')} value={audioSettings.echoFeedback ?? 30}
        onChange={(echoFeedback) => onAudioChange({ echoFeedback })} max={90} />
      <PercentField label={t('effectMix')} help={t('echoMixHelp')} value={audioSettings.echoMix ?? 15}
        onChange={(echoMix) => onAudioChange({ echoMix })} />
      <Toggle label={t('enableReverb')} help={t('enableReverbHelp')} checked={audioSettings.reverbEnabled ?? false}
        onChange={(reverbEnabled) => onAudioChange({ reverbEnabled })} />
      <label className="field compact-field"><FieldLabel help={t('reverbDurationHelp')}>{t('reverbDuration')}</FieldLabel><div className="number-field">
        <input type="number" min="0.1" max="10" step="0.1" value={audioSettings.reverbDuration ?? 1.8}
          onChange={(event) => onAudioChange({ reverbDuration: Math.max(.1, Math.min(10, Number(event.target.value))) })} /><em>s</em>
      </div></label>
      <PercentField label={t('reverbDecay')} help={t('reverbDecayHelp')} value={(audioSettings.reverbDecay ?? 2.4) * 10}
        onChange={(value) => onAudioChange({ reverbDecay: value / 10 })} max={100} />
      <PercentField label={t('effectMix')} help={t('reverbMixHelp')} value={audioSettings.reverbMix ?? 15}
        onChange={(reverbMix) => onAudioChange({ reverbMix })} />
    </div></div>}

    {tab === 'automation' && <div className="settings-tab-content automation-settings">
      <Segmented label={t('displayLevelsAs')} help={t('displayLevelsAsHelp')} value={automation?.displayUnit ?? editingPreferences.automationDisplayUnit} full options={[
        ['percent', t('percentage')], ['db', 'dB']
      ]} onChange={(value) => {
        const displayUnit = value as AutomationState['displayUnit'];
        onEditingPreferencesChange({ automationDisplayUnit: displayUnit });
        if (automation) onAutomationChange({ ...automation, displayUnit });
      }} />
      <Toggle label={t('showAutomations')} help={t('showAutomationsHelp')} checked={automation?.visible ?? editingPreferences.showAutomations}
        onChange={(visible) => {
          onEditingPreferencesChange({ showAutomations: visible });
          if (automation) onAutomationChange({ ...automation, visible });
        }} />
      <div className="shortcut-card"><kbd>⇧ Shift</kbd><p>{t('shiftAutomationHint')}</p></div>
      <p className="settings-help">{t('automationSettingsHelp')}</p>
    </div>}

    {tab === 'editing' && <div className="settings-tab-content automation-settings">
      <Toggle label={t('enableSnap')} help={t('enableSnapHelp')} checked={editingPreferences.snapEnabled}
        onChange={(snapEnabled) => onEditingPreferencesChange({ snapEnabled })} />
      <Segmented label={t('snapMode')} help={t('snapModeHelp')} value={editingPreferences.snapMode} full options={[
        ['smart', t('snapSmart')], ['grid', t('snapGrid')], ['edges', t('snapEdges')], ['original', t('snapOriginal')]
      ]} onChange={(value) => onEditingPreferencesChange({ snapMode: value as EditingPreferences['snapMode'] })} />
      <label className="field full"><FieldLabel help={t('gridStepHelp')}>{t('gridStep')}</FieldLabel><div className="number-field">
        <input type="number" min="10" max="60000" step="10" value={editingPreferences.snapGridMs}
          onChange={(event) => onEditingPreferencesChange({ snapGridMs: Math.max(10, Number(event.target.value)) })} /><em>ms</em>
      </div></label>
      <label className="field full"><FieldLabel help={t('transportSkipIntervalHelp')}>{t('transportSkipInterval')}</FieldLabel><div className="number-field">
        <input type="number" list="transport-skip-presets" min="1" max="86400" step="1" value={editingPreferences.transportSkipSeconds}
          onChange={(event) => onEditingPreferencesChange({ transportSkipSeconds: Math.max(1, Math.min(86400, Math.round(Number(event.target.value)))) })} />
        <em>{t('seconds')}</em>
        <datalist id="transport-skip-presets">{[10, 20, 30, 60, 90, 120, 300, 600].map(value => <option key={value} value={value} />)}</datalist>
      </div></label>
      <Toggle label={t('allowAssetReuse')} help={t('allowAssetReuseHelp')} checked={editingPreferences.allowAssetReuse}
        onChange={(allowAssetReuse) => onEditingPreferencesChange({ allowAssetReuse })} />
      <Toggle label={t('verifyFileIntegrity')} help={t('verifyFileIntegrityHelp')} checked={editingPreferences.verifyFileIntegrity}
        onChange={(verifyFileIntegrity) => onEditingPreferencesChange({ verifyFileIntegrity })} />
      <Toggle label={t('analyzeLoudnessOnImport')} help={t('analyzeLoudnessOnImportHelp')} checked={editingPreferences.analyzeLoudnessOnImport}
        onChange={(analyzeLoudnessOnImport) => onEditingPreferencesChange({ analyzeLoudnessOnImport })} />
      <Toggle label={t('showFileLoudness')} help={t('showFileLoudnessHelp')} checked={editingPreferences.showFileLoudness}
        onChange={(showFileLoudness) => onEditingPreferencesChange({ showFileLoudness })} />
      <div className="settings-divider full"><h3>{t('silenceTrim')}</h3></div>
      <Toggle label={t('enableSilenceTrim')} help={t('enableSilenceTrimHelp')} checked={editingPreferences.trimSilenceEnabled}
        onChange={(trimSilenceEnabled) => onEditingPreferencesChange({ trimSilenceEnabled })} />
      <DbField label={t('silenceThreshold')} help={t('silenceThresholdHelp')} value={editingPreferences.trimSilenceThresholdDb} min={-80} max={-10}
        onChange={(trimSilenceThresholdDb) => onEditingPreferencesChange({ trimSilenceThresholdDb })} />
      <MsField label={t('silencePadding')} help={t('silencePaddingHelp')} value={editingPreferences.trimSilencePaddingMs}
        onChange={(trimSilencePaddingMs) => onEditingPreferencesChange({ trimSilencePaddingMs })} />
      <MsField label={t('minimumSilence')} help={t('minimumSilenceHelp')} value={editingPreferences.trimSilenceMinimumMs}
        onChange={(trimSilenceMinimumMs) => onEditingPreferencesChange({ trimSilenceMinimumMs })} />
      <div className="trim-actions full">
        <button title={t('trimAllVoicesHelp')} disabled={!editingPreferences.trimSilenceEnabled || !voiceAssets.length || trimmingVoices} onClick={onTrimVoices}>
          {t(trimmingVoices ? 'analyzingSilence' : 'trimAllVoices')}
        </button>
        <button title={t('restoreVoiceTrimsHelp')} disabled={!voiceAssets.some(asset => asset.sourceDurationMs !== undefined) || trimmingVoices} onClick={onRestoreVoiceTrims}>
          {t('restoreVoiceTrims')}
        </button>
      </div>
      <p className="settings-help full">{t('silenceTrimHelp')}</p>
      <div className="shortcut-card full"><kbd>⇧ Shift</kbd><p>{t('musicRippleHint')}</p></div>
      <p className="settings-help">{t('integrityHelp')}</p>
      <p className="settings-help">{t('snapControlHint')}</p>
    </div>}

  </aside>;
}

function DbField({ label, help, value, onChange, min = -60, max = 6 }: {
  label: string; help?: string; value: number; onChange: (value: number) => void; min?: number; max?: number;
}) {
  return <label className="field compact-field"><FieldLabel help={help}>{label}</FieldLabel><div className="number-field">
    <input type="number" min={min} max={max} step="0.5" value={value}
      onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value))))} /><em>dB</em>
  </div></label>;
}

function MsField({ label, help, value, onChange }: { label: string; help?: string; value: number; onChange: (value: number) => void }) {
  return <label className="field compact-field"><FieldLabel help={help}>{label}</FieldLabel><div className="number-field">
    <input type="number" min="0" max="30000" step="50" value={value}
      onChange={(event) => onChange(Math.min(30_000, Math.max(0, Number(event.target.value))))} /><em>ms</em>
  </div></label>;
}

function PercentField({ label, help, value, onChange, max = 100 }: { label: string; help?: string; value: number; onChange: (value: number) => void; max?: number }) {
  return <label className="field compact-field"><FieldLabel help={help}>{label}</FieldLabel><div className="number-field">
    <input type="number" min="0" max={max} step="1" value={Math.round(value)}
      onChange={(event) => onChange(Math.min(max, Math.max(0, Number(event.target.value))))} /><em>%</em>
  </div></label>;
}

function Segmented({ label, help, value, options, onChange, full = false }: {
  label: string; help?: string; value: string; options: [string, string][]; onChange: (value: string) => void; full?: boolean;
}) {
  return <div className={`field segmented-field ${full ? 'full' : ''}`}>
    <FieldLabel help={help}>{label}</FieldLabel>
    <div className="segmented">{options.map(([option, title]) =>
      <button key={option} className={value === option ? 'selected' : ''} onClick={() => onChange(option)}>{title}</button>
    )}</div>
  </div>;
}

function Toggle({ label, help, checked, onChange }: { label: string; help?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-field"><FieldLabel help={help}>{label}</FieldLabel><input type="checkbox" checked={checked}
    onChange={(event) => onChange(event.target.checked)} /><i /></label>;
}

function TimelineClipView({ clip, waveform, overlapping, arrangement, canvasRef, preferences, dimmed, highlighted, selected,
  onSelect, onMove, onRemove, onFadeChange, onSourceTrimChange, onDragGuide, onDragEnd }: {
  clip: TimelineClip;
  waveform: number[];
  overlapping: boolean;
  arrangement: Arrangement;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  preferences: EditingPreferences;
  dimmed: boolean;
  highlighted: boolean;
  selected: boolean;
  onSelect: (clipId: string, additive: boolean) => void;
  onMove: (clipId: string, kind: TimelineClip['kind'], startMs: number, guideMs: number | null, isolated: boolean) => void;
  onRemove: (clip: TimelineClip) => void;
  onFadeChange: (clipId: string, kind: TimelineClip['kind'], edge: 'in' | 'out', durationMs: number) => void;
  onSourceTrimChange: (clipId: string, sourceOffsetMs: number, durationMs: number, startMs: number) => void;
  onDragGuide: (guideMs: number | null) => void;
  onDragEnd: () => void;
}) {
  const { t } = useTranslation();
  const [drag, setDrag] = useState<{ clientX: number; startMs: number; previewStartMs: number; guideMs: number | null; moved: boolean } | null>(null);
  const [fadeDrag, setFadeDrag] = useState<{ edge: 'in' | 'out'; clientX: number; initialMs: number } | null>(null);
  const [trimDrag, setTrimDrag] = useState<{ edge: 'in' | 'out'; clientX: number; initialOffsetMs: number;
    initialDurationMs: number; previewOffsetMs: number; previewDurationMs: number; previewStartMs: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const totalMs = arrangement.durationMs;
  const left = ((trimDrag?.previewStartMs ?? drag?.previewStartMs ?? clip.startMs) / totalMs) * 100;
  const displayDurationMs = trimDrag?.previewDurationMs ?? clip.durationMs;
  const width = Math.max((displayDurationMs / totalMs) * 100, 0.18);
  const style = { left: `${left}%`, width: `${width}%`, backgroundColor: clip.color };
  const fadeInPercent = Math.min(100, (clip.fadeInMs ?? 0) / clip.durationMs * 100);
  const fadeOutPercent = Math.min(100, (clip.fadeOutMs ?? 0) / clip.durationMs * 100);
  const originalSourceDurationMs = clip.originalSourceDurationMs ?? clip.sourceDurationMs ?? clip.durationMs;
  const visibleOffsetMs = trimDrag?.previewOffsetMs ?? clip.sourceOffsetMs ?? 0;
  const waveformStart = Math.max(0, Math.floor(waveform.length * visibleOffsetMs / Math.max(1, originalSourceDurationMs)));
  const waveformEnd = Math.min(waveform.length, Math.ceil(waveform.length * (visibleOffsetMs + displayDurationMs) / Math.max(1, originalSourceDurationMs)));
  const visibleWaveform = waveform.slice(waveformStart, Math.max(waveformStart + 1, waveformEnd));
  const waveformPath = visibleWaveform.map((peak, index) => `M${index + .5} ${50 - peak * 43}V${50 + peak * 43}`).join('');
  const startFadeDrag = (event: React.PointerEvent<HTMLButtonElement>, edge: 'in' | 'out') => {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    setFadeDrag({ edge, clientX: event.clientX, initialMs: edge === 'in' ? (clip.fadeInMs ?? 0) : (clip.fadeOutMs ?? 0) });
  };
  const startTrimDrag = (event: React.PointerEvent<HTMLButtonElement>, edge: 'in' | 'out') => {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    setTrimDrag({ edge, clientX: event.clientX, initialOffsetMs: clip.sourceOffsetMs ?? 0, initialDurationMs: clip.durationMs,
      previewOffsetMs: clip.sourceOffsetMs ?? 0, previewDurationMs: clip.durationMs, previewStartMs: clip.startMs });
  };
  const moveTrimDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!trimDrag || !canvasRef.current) return;
    event.preventDefault(); event.stopPropagation();
    const deltaMs = (event.clientX - trimDrag.clientX) / Math.max(1, canvasRef.current.getBoundingClientRect().width) * arrangement.durationMs;
    const originalEnd = trimDrag.initialOffsetMs + trimDrag.initialDurationMs;
    if (trimDrag.edge === 'in') {
      let previewOffsetMs = Math.max(0, Math.min(originalEnd - 100, trimDrag.initialOffsetMs + deltaMs));
      let previewStartMs = clip.startMs + previewOffsetMs - trimDrag.initialOffsetMs;
      if (previewStartMs < 0) { previewOffsetMs -= previewStartMs; previewStartMs = 0; }
      setTrimDrag(current => current ? { ...current, previewOffsetMs, previewDurationMs: originalEnd - previewOffsetMs, previewStartMs } : current);
    } else {
      const maximumEndMs = Math.min(originalSourceDurationMs,
        trimDrag.initialOffsetMs + Math.max(100, arrangement.durationMs - clip.startMs));
      const previewEndMs = Math.max(trimDrag.initialOffsetMs + 100, Math.min(maximumEndMs, originalEnd + deltaMs));
      setTrimDrag(current => current ? { ...current, previewDurationMs: previewEndMs - trimDrag.initialOffsetMs } : current);
    }
  };
  const finishTrimDrag = () => {
    if (trimDrag) onSourceTrimChange(clip.id, Math.round(trimDrag.previewOffsetMs), Math.round(trimDrag.previewDurationMs), Math.round(trimDrag.previewStartMs));
    setTrimDrag(null);
  };
  return <div className={`timeline-clip ${clip.kind} ${clip.truncated ? 'truncated' : ''} ${drag ? 'dragging' : ''} ${selected ? 'clip-selected' : ''} ${dimmed ? 'clip-dimmed' : ''} ${highlighted ? 'clip-highlighted' : ''} ${overlapping ? 'clip-overlapping' : ''}`} style={style}
    title={`${clip.kind === 'missing' ? t('missingMusic') : clip.name} · ${formatDuration(clip.durationMs)}`}
    role={clip.kind === 'missing' ? undefined : 'button'} aria-pressed={clip.kind === 'missing' ? undefined : selected}
    tabIndex={clip.kind === 'missing' ? undefined : 0}
    onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      if (clip.kind !== 'missing' && event.key === 'Enter') {
        event.preventDefault(); onSelect(clip.id, event.shiftKey || event.metaKey || event.ctrlKey);
      }
    }}
    onPointerDown={(event) => {
      if (clip.kind === 'missing' || event.button !== 0) return;
      event.stopPropagation();
      onSelect(clip.id, event.shiftKey || event.metaKey || event.ctrlKey);
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ clientX: event.clientX, startMs: clip.startMs, previewStartMs: clip.startMs, guideMs: null, moved: false });
      setMenu(null);
    }}
    onPointerMove={(event) => {
      if (!drag || !canvasRef.current) return;
      event.stopPropagation();
      if (!drag.moved && Math.abs(event.clientX - drag.clientX) < 2) return;
      const widthPx = canvasRef.current.getBoundingClientRect().width;
      const proposed = drag.startMs + (event.clientX - drag.clientX) / widthPx * arrangement.durationMs;
      if (!preferences.snapEnabled || event.ctrlKey) {
        const previewStartMs = Math.max(0, Math.min(arrangement.durationMs - clip.durationMs, proposed));
        setDrag(current => current ? { ...current, previewStartMs, guideMs: null, moved: true } : current);
        onDragGuide(null);
        return;
      }
      const snapped = snapClipStart({
        proposedStartMs: proposed, clip, arrangement, mode: preferences.snapMode,
        gridMs: preferences.snapGridMs, toleranceMs: arrangement.durationMs / widthPx * 10
      });
      setDrag(current => current ? { ...current, previewStartMs: snapped.startMs, guideMs: snapped.guideMs, moved: true } : current);
      onDragGuide(snapped.guideMs);
    }}
    onPointerUp={(event) => {
      event.stopPropagation();
      if (drag?.moved) onMove(clip.id, clip.kind, drag.previewStartMs, drag.guideMs, event.shiftKey);
      setDrag(null); onDragEnd();
    }}
    onPointerCancel={() => { setDrag(null); onDragEnd(); }}
    onContextMenu={(event) => {
      if (clip.kind === 'missing') return;
      event.preventDefault(); event.stopPropagation();
      onSelect(clip.id, false);
      setMenu({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY });
    }}>
    {clip.kind !== 'missing' && <svg className="clip-waveform" viewBox={`0 0 ${Math.max(1, visibleWaveform.length)} 100`} preserveAspectRatio="none" aria-hidden="true">
      <path d={waveformPath} />
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
    {clip.kind === 'voice' && <button className="source-trim-handle source-trim-in" title={t('adjustSourceStart')}
      onPointerDown={(event) => startTrimDrag(event, 'in')} onPointerMove={moveTrimDrag} onPointerUp={finishTrimDrag}>↔</button>}
    {clip.kind === 'voice' && <button className="source-trim-handle source-trim-out" title={t('adjustSourceEnd')}
      onPointerDown={(event) => startTrimDrag(event, 'out')} onPointerMove={moveTrimDrag} onPointerUp={finishTrimDrag}>↔</button>}
    <span>{clip.kind === 'missing' ? t('missingMusic') : clip.name}</span>
    {clip.kind !== 'missing' && <small>{formatDuration(clip.durationMs)}</small>}
    {clip.manuallyPositioned && <i className="manual-position-dot" title={t('manuallyPositioned')}>⚓</i>}
    {menu && <div className="clip-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
      <button onClick={(event) => { event.stopPropagation(); onMove(clip.id, clip.kind, clip.generatedStartMs, clip.generatedStartMs, true); setMenu(null); }}>↩ {t('restoreGeneratedPosition')}</button>
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
  meter: LoudnessMeterReading;
  automation: AutomationState | null;
  editingPreferences: EditingPreferences;
  canMount: boolean;
  onMount: () => void;
  onAutomationChange: (state: AutomationState) => void;
  onEditingPreferencesChange: (patch: Partial<EditingPreferences>) => void;
  onMoveClip: (clipId: string, kind: TimelineClip['kind'], startMs: number, guideMs: number | null, isolated: boolean) => void;
  onRemoveClips: (clipIds: string[]) => void;
  onFadeChange: (clipId: string, kind: TimelineClip['kind'], edge: 'in' | 'out', durationMs: number) => void;
  onSourceTrimChange: (clipId: string, sourceOffsetMs: number, durationMs: number, startMs: number) => void;
  onTabChange: (id: string, patch: Partial<LibraryTab>) => void;
  onDropAsset: (assetId: string, kind: MediaKind, startMs: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (positionMs: number) => void;
}

function Timeline({ arrangement, tabs, assets, isPlaying, positionMs, musicGainDb, meter, automation, editingPreferences, canMount, onMount,
  onAutomationChange, onEditingPreferencesChange, onMoveClip, onRemoveClips, onFadeChange, onSourceTrimChange, onTabChange, onDropAsset, onPlay, onPause, onSeek }: TimelineProps) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const [snapGuideMs, setSnapGuideMs] = useState<number | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(() => new Set());
  const canvasRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const zoomAnchorRef = useRef<{ contentRatio: number; pointerOffset: number } | null>(null);
  const fitZoom = fitTimelineZoom(arrangement?.durationMs ?? 0);
  const width = arrangement ? Math.max(100, arrangement.durationMs / 60_000 * 70 * zoom) : 100;
  const markerStepMs = arrangement && arrangement.durationMs <= 15 * 60_000 ? 60_000 : 5 * 60_000;
  const markers = arrangement ? Array.from({ length: Math.floor(arrangement.durationMs / markerStepMs) + 1 }, (_, index) => index * markerStepMs) : [];
  const voiceTabs = tabs.filter(tab => tab.kind === 'voice');
  const musicTabs = tabs.filter(tab => tab.kind === 'music');
  const timelineRows = [
    ...voiceTabs.map(tab => ({ id: tab.id, tab, clips: arrangement?.voice.filter(clip => clip.libraryTabId === tab.id) ?? [], laneIndex: 0, laneCount: 1 })),
    ...musicTabs.flatMap((tab, tabIndex) => {
      const clips = arrangement?.music.filter(clip => clip.libraryTabId === tab.id || (clip.kind === 'missing' && tabIndex === 0)) ?? [];
      const lanes = allocateClipLanes(clips);
      return lanes.map((lane, laneIndex) => ({ id: `${tab.id}-lane-${laneIndex}`, tab, clips: lane, laneIndex, laneCount: lanes.length }));
    })
  ];
  const waveforms = new Map(assets.map(asset => [asset.id, asset.waveform ?? []]));
  const voiceOverlaps = arrangement ? overlappingClipIds(arrangement.voice) : new Set<string>();
  const durationMs = arrangement?.durationMs ?? 0;

  useEffect(() => {
    const scroll = timelineScrollRef.current;
    if (!scroll) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const bounds = scroll.getBoundingClientRect();
      const pointerOffset = Math.max(0, Math.min(scroll.clientWidth, event.clientX - bounds.left));
      zoomAnchorRef.current = {
        contentRatio: (scroll.scrollLeft + pointerOffset) / Math.max(1, scroll.scrollWidth),
        pointerOffset
      };
      const deltaY = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? event.deltaY * scroll.clientHeight : event.deltaY;
      setZoom(current => zoomFromPinch(current, deltaY, fitZoom));
    };
    scroll.addEventListener('wheel', handleWheel, { passive: false });
    return () => scroll.removeEventListener('wheel', handleWheel);
  }, [arrangement, fitZoom]);

  useEffect(() => setZoom(current => Math.max(fitZoom, Math.min(4, current))), [fitZoom]);

  useLayoutEffect(() => {
    const scroll = timelineScrollRef.current;
    const anchor = zoomAnchorRef.current;
    if (!scroll || !anchor) return;
    scroll.scrollLeft = anchoredScrollLeft(anchor.contentRatio, anchor.pointerOffset, scroll.scrollWidth, scroll.clientWidth);
    zoomAnchorRef.current = null;
  }, [zoom]);

  useEffect(() => {
    const available = new Set(arrangement ? [...arrangement.music, ...arrangement.voice].map(clip => clip.id) : []);
    setSelectedClipIds(current => new Set([...current].filter(id => available.has(id))));
  }, [arrangement]);

  useEffect(() => {
    const removeSelected = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      if (!selectedClipIds.size) return;
      event.preventDefault(); event.stopPropagation();
      onRemoveClips([...selectedClipIds]);
      setSelectedClipIds(new Set());
    };
    window.addEventListener('keydown', removeSelected, { capture: true });
    return () => window.removeEventListener('keydown', removeSelected, { capture: true });
  }, [onRemoveClips, selectedClipIds]);

  const selectClip = (clipId: string, additive: boolean) => setSelectedClipIds(current => {
    if (!additive) return new Set([clipId]);
    const next = new Set(current);
    if (next.has(clipId)) next.delete(clipId); else next.add(clipId);
    return next;
  });

  return <section className="timeline-section">
    <div className="timeline-toolbar">
      <div className="timeline-toolbar-left">
        <div className="timeline-summary">{t('summary', {
          music: arrangement?.music.filter(c => c.kind !== 'missing').length ?? 0,
          voice: arrangement?.voice.length ?? 0,
          duration: formatDuration(durationMs)
        })}</div>
        <div className="transport-time"><time className="transport-position">{formatDuration(positionMs, true)}</time>
          <span>/</span><time className="transport-duration">{formatDuration(durationMs)}</time></div>
      </div>
      <div className="transport-controls">
        <button className="transport-skip" disabled={!arrangement || positionMs <= 0}
          onClick={() => onSeek(positionMs - editingPreferences.transportSkipSeconds * 1000)}
          aria-label={t('skipBackward', { seconds: editingPreferences.transportSkipSeconds })}
          title={`${t('skipBackward', { seconds: editingPreferences.transportSkipSeconds })} · ←`}>←</button>
        <button className="transport-primary" disabled={!arrangement} onClick={isPlaying ? onPause : onPlay}
          aria-label={t(isPlaying ? 'pauseProgram' : 'playProgram')}>{isPlaying ? 'Ⅱ' : '▶'}</button>
        <button className="transport-skip" disabled={!arrangement || positionMs >= durationMs}
          onClick={() => onSeek(positionMs + editingPreferences.transportSkipSeconds * 1000)}
          aria-label={t('skipForward', { seconds: editingPreferences.transportSkipSeconds })}
          title={`${t('skipForward', { seconds: editingPreferences.transportSkipSeconds })} · →`}>→</button>
      </div>
      <input className="transport-seek-slider" type="range" min="0" max={durationMs} step="100" value={positionMs}
        onChange={(event) => onSeek(Number(event.target.value))} />
      <div className="timeline-toolbar-right">
        <div className="transport-meters">
          <div className="gain-meter"><span>{t('musicGain')}</span><strong>{musicGainDb.toFixed(1)} dB</strong>
            <i style={{ width: `${Math.max(0, Math.min(100, (musicGainDb + 80) / 80 * 100))}%` }} /></div>
          <div className="loudness-meter" title={t('loudnessMeterHelp')}>
            <span>M <b>{meter.momentary.toFixed(1)}</b></span><span>S <b>{meter.shortTerm.toFixed(1)}</b></span>
            <span>I <b>{meter.integrated.toFixed(1)}</b></span><span>PK <b>{meter.peakDbfs.toFixed(1)}</b></span>
            <i style={{ width: `${Math.max(0, Math.min(100, (meter.momentary + 60) / 51 * 100))}%` }} />
          </div>
        </div>
        <div className="timeline-tools"><button className={`magnet-button ${editingPreferences.snapEnabled ? 'active' : ''}`}
        onClick={() => onEditingPreferencesChange({ snapEnabled: !editingPreferences.snapEnabled })}
        title={t('toggleSnap')}>🧲</button>
          <select value={editingPreferences.snapMode} onChange={(event) => onEditingPreferencesChange({ snapMode: event.target.value as EditingPreferences['snapMode'] })}
            aria-label={t('snapMode')}>
            <option value="smart">{t('snapSmart')}</option><option value="grid">{t('snapGrid')}</option>
            <option value="edges">{t('snapEdges')}</option><option value="original">{t('snapOriginal')}</option>
          </select>
          <div className="zoom-control" title={t('trackpadZoomHint')}><span>{t('zoom')}</span>
            <button className="fit-zoom-button" onClick={() => setZoom(fitZoom)} title={t('fitTimeline')}>{t('fit')}</button>
            <button onClick={() => setZoom(Math.max(fitZoom, zoom / 1.25))}>−</button>
            <output>{zoom < .1 ? (zoom * 100).toFixed(1) : Math.round(zoom * 100)}%</output>
            <button onClick={() => setZoom(Math.min(4, zoom * 1.25))}>＋</button></div>
        </div>
        <button className="timeline-mount-button" title={t('mountHelp')} disabled={!canMount} onClick={onMount}>
          <span>{t(arrangement ? 'remount' : 'mount')}</span><b aria-hidden="true">→</b>
        </button>
      </div>
    </div>

    {!arrangement ? <div className="timeline-empty"><p>{t('timelineEmpty')}</p></div> : <>
      {arrangement.warnings.length > 0 && <div className="warnings">{arrangement.warnings.map(warning =>
        <p key={warning}>! {t(warning === 'missingMusic' ? 'warningMissingMusic'
          : warning === 'durationExtendedForVoices' ? 'warningDurationExtended'
          : warning === 'voiceSpacingReduced' ? 'warningSpacingReduced' : 'warningVoiceOutside')}</p>)}</div>}
      {voiceOverlaps.size > 0 && <div className="warnings overlap-warning"><p>! {t('warningVoiceOverlap', { count: voiceOverlaps.size })}</p></div>}
      <div className="timeline-shell">
        <div className="track-labels">
          <div className="ruler-spacer" />
          {timelineRows.map(row => <div key={row.id} title={row.tab.name}><span className="track-dot" style={{ background: row.tab.color }} />
            <span className="track-name">{row.tab.name}</span>{row.laneCount > 1 && <small className="music-lane-label"> {String.fromCharCode(65 + row.laneIndex)}</small>}
            {row.tab.localAutomationEnabled && row.laneIndex === 0 && <small> A</small>}</div>)}
          {automation?.visible && <div className="automation-track-label"><span className="track-dot automation-dot" />{t('automationTrack')}</div>}
        </div>
        <div className="timeline-scroll" ref={timelineScrollRef}>
          <div ref={canvasRef} className="timeline-canvas" style={{ width: `${width}%` }} onClick={(event) => {
            setSelectedClipIds(new Set());
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
            {timelineRows.map(row => <div className={`track ${row.tab.kind}-track ${row.laneCount > 1 ? 'overlap-lane' : ''}`} key={row.id}>
              {row.clips.map(clip => <TimelineClipView key={clip.id} clip={clip}
                  waveform={clip.assetId ? (waveforms.get(clip.assetId) ?? []) : []} overlapping={voiceOverlaps.has(clip.id)}
                  arrangement={arrangement} canvasRef={canvasRef} preferences={editingPreferences}
                  dimmed={false} selected={selectedClipIds.has(clip.id)} onSelect={selectClip}
                  highlighted={false}
                  onMove={onMoveClip} onRemove={(item) => onRemoveClips([item.id])} onFadeChange={onFadeChange} onSourceTrimChange={onSourceTrimChange}
                  onDragGuide={setSnapGuideMs}
                  onDragEnd={() => setSnapGuideMs(null)} />)}
              {row.tab.localAutomationEnabled && row.laneIndex === 0 && <TrackAutomationLane tab={row.tab}
                onChange={(automationPoints) => onTabChange(row.tab.id, { automationPoints })} />}
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
  const [musicInsertion, setMusicInsertion] = useState<InsertionConfig>(defaultMusicInsertion);
  const [voiceInsertion, setVoiceInsertion] = useState<InsertionConfig>(defaultVoiceInsertion);
  const [settings, setSettings] = useState(defaultSettings);
  const [audioSettings, setAudioSettings] = useState(defaultAudioSettings);
  const [arrangement, setArrangement] = useState<Arrangement | null>(null);
  const [automation, setAutomation] = useState<AutomationState | null>(null);
  const [editingPreferences, setEditingPreferences] = useState(defaultEditingPreferences);
  const [activePreview, setActivePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string | undefined>();
  const [projectName, setProjectName] = useState('Proyecto sin título');
  const [exportOpen, setExportOpen] = useState(false);
  const [quarantine, setQuarantine] = useState<QuarantineItem[]>([]);
  const [importLogs, setImportLogs] = useState<ImportLog[]>([]);
  const [quarantineOpen, setQuarantineOpen] = useState(false);
  const [importLogOpen, setImportLogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [trimmingVoices, setTrimmingVoices] = useState(false);
  const [settingsCollapsed, setSettingsCollapsed] = useState(() => localStorage.getItem('francis-settings-collapsed') === 'true');
  const [, setHistoryRevision] = useState(0);
  const [importProgressJobs, setImportProgressJobs] = useState<Array<{
    id: string; kind?: MediaKind; label: string; completed: number; total: number;
  }>>([]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const previewGeneration = useRef(0);
  const activePreviewRef = useRef<string | null>(null);
  const waveformHydrationGeneration = useRef(0);
  const progressDismissTimers = useRef(new Map<string, number>());
  const historyRef = useRef<ProjectSnapshot[]>([]);
  const historyIndexRef = useRef(-1);
  const historyReadyRef = useRef(false);
  const applyingHistoryRef = useRef(false);
  const savedSignatureRef = useRef('');
  const allAssets = useMemo(() => [...music, ...voices], [music, voices]);
  const musicSequence = useMemo(() => createInsertionSequence(libraryTabs.filter(tab => tab.kind === 'music'), music,
    activeMusicTabId, musicInsertion, settings.seed), [libraryTabs, music, activeMusicTabId, musicInsertion, settings.seed]);
  const voiceSequence = useMemo(() => createInsertionSequence(libraryTabs.filter(tab => tab.kind === 'voice'), voices,
    activeVoiceTabId, voiceInsertion, settings.seed + 10_000), [libraryTabs, voices, activeVoiceTabId, voiceInsertion, settings.seed]);
  const scheduledVoiceSequence = useMemo(() => settings.voiceOrder === 'random'
    ? shuffleWithSeed(voiceSequence, settings.seed + 10_000) : voiceSequence,
  [voiceSequence, settings.voiceOrder, settings.seed]);
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
    previewGeneration.current += 1;
    audio.current?.pause();
    audio.current?.removeAttribute('src');
    assetsRef.current.forEach(asset => URL.revokeObjectURL(asset.previewUrl));
  }, []); // URLs are intentionally cleaned only when the app closes.

  useEffect(() => {
    localStorage.setItem('francis-settings-collapsed', String(settingsCollapsed));
  }, [settingsCollapsed]);

  useEffect(() => window.francisDesktop?.onImportProgress(progress => {
    const id = progress.jobId ?? 'background-analysis';
    setImportProgressJobs(current => {
      const existing = current.some(job => job.id === id);
      if (!existing && progress.total > 0 && progress.completed >= progress.total) return current;
      const label = progress.kind === 'music' ? t('analyzingMusic') : progress.kind === 'voice' ? t('analyzingVoices') : t('analyzingFiles');
      return existing
        ? current.map(job => job.id === id ? { ...job, completed: progress.completed, total: progress.total } : job)
        : [...current, { id, kind: progress.kind, label, completed: progress.completed, total: progress.total }];
    });
  }), [t]);

  useEffect(() => {
    importProgressJobs.filter(job => job.total > 0 && job.completed >= job.total).forEach(job => {
      if (progressDismissTimers.current.has(job.id)) return;
      const timeout = window.setTimeout(() => {
        progressDismissTimers.current.delete(job.id);
        setImportProgressJobs(current => current.filter(candidate => candidate.id !== job.id));
      }, 900);
      progressDismissTimers.current.set(job.id, timeout);
    });
  }, [importProgressJobs]);

  useEffect(() => () => {
    progressDismissTimers.current.forEach(timeout => window.clearTimeout(timeout));
    progressDismissTimers.current.clear();
  }, []);

  useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(() => setError(null), 8000);
    return () => window.clearTimeout(timeout);
  }, [error]);

  useEffect(() => {
    if (!scheduledVoiceSequence.length || settings.voicePlacement !== 'interval') return;
    const patch = settings.durationFromVoices
      ? { targetDurationMs: voiceScheduleDuration(scheduledVoiceSequence, settings.voiceIntervalMs, settings.allowVoiceOverlap) }
      : { voiceIntervalMs: intervalForVoiceDuration(scheduledVoiceSequence, settings.targetDurationMs, settings.allowVoiceOverlap) };
    const [key, value] = Object.entries(patch)[0] as ['targetDurationMs' | 'voiceIntervalMs', number];
    if (Math.abs(settings[key] - value) > 50) setSettings(current => ({ ...current, ...patch }));
  }, [scheduledVoiceSequence, settings.durationFromVoices, settings.voicePlacement, settings.voiceIntervalMs, settings.targetDurationMs, settings.allowVoiceOverlap]);

  const status = useMemo(() => arrangement ? formatDuration(arrangement.durationMs) : t('projectReady'), [arrangement, t]);

  const addFiles = async (files: File[], kind: MediaKind, tabId: string) => {
    if (!files.length) return;
    setError(null);
    let importJobId: string | undefined;
    let trimJobId: string | undefined;
    try {
      let assets: MediaAsset[];
      if (window.francisDesktop) {
        const inputPaths = files.map(file => window.francisDesktop!.getPathForFile(file)).filter(Boolean);
        importJobId = crypto.randomUUID();
        setImportProgressJobs(current => [...current, { id: importJobId!, kind,
          label: t(kind === 'music' ? 'analyzingMusic' : 'analyzingVoices'), completed: 0, total: inputPaths.length }]);
        const result = await window.francisDesktop.importPaths({ inputPaths, kind, tabId, jobId: importJobId,
          verifyIntegrity: editingPreferences.verifyFileIntegrity,
          analyzeLoudness: editingPreferences.analyzeLoudnessOnImport,
          normalizationTargetLufs: audioSettings.normalizationTargetLufs ?? -23,
          truePeakCeilingDbtp: audioSettings.truePeakCeilingDbtp ?? -1,
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
        if (kind === 'voice' && editingPreferences.trimSilenceEnabled && assets.length && window.francisDesktop.analyzeSilence) {
          trimJobId = crypto.randomUUID();
          setImportProgressJobs(current => [...current, { id: trimJobId!, kind: 'voice',
            label: t('analyzingSilence'), completed: 0, total: assets.length }]);
          try {
            const bounds = await window.francisDesktop.analyzeSilence({
              jobId: trimJobId,
              items: assets.map(asset => ({ path: asset.path, durationMs: asset.durationMs })),
              thresholdDb: editingPreferences.trimSilenceThresholdDb,
              paddingMs: editingPreferences.trimSilencePaddingMs,
              minimumSilenceMs: editingPreferences.trimSilenceMinimumMs
            });
            assets = applySilenceBounds(assets, bounds);
          } catch {
            setError(t('silenceTrimError'));
          } finally {
            setImportProgressJobs(current => current.filter(job => job.id !== trimJobId));
          }
        }
        setQuarantine(current => [...current, ...result.quarantined]);
        setImportLogs(current => [result.log, ...current]);
        const tab = libraryTabs.find(item => item.id === tabId);
        if (!existing && tab && /^(Música|Music|Locuciones|Voice spots?)\s+\d+$/i.test(tab.name)) updateLibraryTab(tabId, { name: result.suggestedName });
        if (result.quarantined.length) setQuarantineOpen(true);
      } else assets = await filesToAssets(files, kind, tabId);
      if (kind === 'music') setMusic(current => [...current, ...assets]);
      else setVoices(current => [...current, ...assets]);
      if (window.francisDesktop?.preparePreviews) void window.francisDesktop.preparePreviews(assets.map(asset => asset.path)).catch(() => undefined);
    } catch {
      setError(t('fileError'));
    } finally {
      if (importJobId) setImportProgressJobs(current => current.filter(job => job.id !== importJobId));
      if (trimJobId) setImportProgressJobs(current => current.filter(job => job.id !== trimJobId));
    }
  };

  const removeAsset = (id: string) => {
    setMusic(current => current.filter(item => item.id !== id));
    setVoices(current => current.filter(item => item.id !== id));
    setArrangement(null);
    setAutomation(null);
  };

  const stopPreview = () => {
    previewGeneration.current += 1;
    const current = audio.current;
    if (current) {
      current.pause();
      current.removeAttribute('src');
      current.load();
    }
    audio.current = null;
    activePreviewRef.current = null;
    setActivePreview(null);
  };

  useEffect(() => {
    const handleTimelineKeys = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (event.repeat || !arrangement) return;
        if (player.isPlaying || player.isPreparing) player.pause();
        else { stopPreview(); player.play(); }
        return;
      }
      if (!arrangement || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      player.seek(player.positionMs + direction * editingPreferences.transportSkipSeconds * 1000);
    };
    window.addEventListener('keydown', handleTimelineKeys, { capture: true });
    return () => window.removeEventListener('keydown', handleTimelineKeys, { capture: true });
  }, [arrangement, editingPreferences.transportSkipSeconds, player.isPlaying, player.isPreparing,
    player.pause, player.play, player.positionMs, player.seek]);

  const preview = async (asset: MediaAsset) => {
    player.pause();
    if (activePreviewRef.current === asset.id) {
      stopPreview();
      return;
    }
    stopPreview();
    const generation = previewGeneration.current;
    activePreviewRef.current = asset.id;
    setActivePreview(asset.id);
    const playUrl = async (url: string) => {
      if (generation !== previewGeneration.current) return false;
      const next = new Audio(url);
      next.preload = 'auto';
      next.onended = () => {
        if (generation !== previewGeneration.current) return;
        audio.current = null;
        activePreviewRef.current = null;
        setActivePreview(null);
      };
      const trimEndSeconds = (asset.trimEndMs ?? asset.sourceDurationMs ?? asset.durationMs) / 1000;
      next.ontimeupdate = () => {
        if (asset.trimEndMs !== undefined && next.currentTime >= trimEndSeconds) stopPreview();
      };
      audio.current = next;
      if (next.readyState < HTMLMediaElement.HAVE_METADATA) await new Promise<void>((resolve, reject) => {
        next.addEventListener('loadedmetadata', () => resolve(), { once: true });
        next.addEventListener('error', () => reject(new Error('Metadata unavailable')), { once: true });
      });
      next.currentTime = (asset.trimStartMs ?? 0) / 1000;
      await next.play();
      if (generation !== previewGeneration.current) {
        next.pause(); next.removeAttribute('src'); next.load();
        return false;
      }
      return true;
    };
    try {
      await playUrl(asset.previewUrl);
    } catch {
      try {
        if (generation !== previewGeneration.current) return;
        if (!asset.previewUrl.startsWith('francis-media:')) throw new Error('No desktop proxy available');
        const failed = audio.current;
        failed?.pause(); failed?.removeAttribute('src'); failed?.load();
        await playUrl(`${asset.previewUrl}&proxy=1`);
      } catch {
        if (generation !== previewGeneration.current) return;
        stopPreview();
        setError(t('previewError', { name: asset.name }));
      }
    }
  };

  const buildArrangement = (nextSettings: ArrangementSettings) => {
    stopPreview();
    player.reset();
    const next = createArrangement(musicSequence, voiceSequence, nextSettings);
    const showAutomationTrack = next.voice.length > 0 || editingPreferences.showAutomations;
    setArrangement(next);
    setAutomation({ ...createAutomationState(next, audioSettings),
      displayUnit: editingPreferences.automationDisplayUnit,
      visible: showAutomationTrack });
    if (showAutomationTrack !== editingPreferences.showAutomations) {
      setEditingPreferences(current => ({ ...current, showAutomations: showAutomationTrack }));
    }
  };

  const mount = () => buildArrangement(settings);

  const rebuildAfterVoiceEdit = (nextVoices: MediaAsset[], preserveManualSourceTrims = false) => {
    const nextVoiceSequence = createInsertionSequence(libraryTabs.filter(tab => tab.kind === 'voice'), nextVoices,
      activeVoiceTabId, voiceInsertion, settings.seed + 10_000);
    const nextScheduledVoices = settings.voiceOrder === 'random'
      ? shuffleWithSeed(nextVoiceSequence, settings.seed + 10_000) : nextVoiceSequence;
    const nextSettings = settings.durationFromVoices && nextScheduledVoices.length
      ? { ...settings, targetDurationMs: voiceScheduleDuration(nextScheduledVoices, settings.voiceIntervalMs, settings.allowVoiceOverlap) }
      : settings;
    if (nextSettings !== settings) setSettings(nextSettings);
    if (!arrangement) return;
    player.reset(); stopPreview();
    const generated = createArrangement(musicSequence, nextVoiceSequence, nextSettings);
    const next = { ...generated, voice: preserveManualVoicePositions(arrangement.voice, generated.voice, generated.durationMs, preserveManualSourceTrims) };
    setArrangement(next);
    setAutomation(current => current ? reconcileAutomationAssignments(current, arrangement.voice, next.voice) : current);
  };

  const trimAllVoices = async () => {
    if (!window.francisDesktop?.analyzeSilence || !voices.length || trimmingVoices) return;
    const jobId = crypto.randomUUID();
    setTrimmingVoices(true); setError(null);
    setImportProgressJobs(current => [...current, { id: jobId, kind: 'voice', label: t('analyzingSilence'), completed: 0, total: voices.length }]);
    try {
      const results = await window.francisDesktop.analyzeSilence({
        jobId,
        items: voices.map(asset => ({ path: asset.path, durationMs: asset.sourceDurationMs ?? asset.durationMs })),
        thresholdDb: editingPreferences.trimSilenceThresholdDb,
        paddingMs: editingPreferences.trimSilencePaddingMs,
        minimumSilenceMs: editingPreferences.trimSilenceMinimumMs
      });
      const nextVoices = applySilenceBounds(voices, results);
      setVoices(nextVoices); rebuildAfterVoiceEdit(nextVoices);
    } catch {
      setError(t('silenceTrimError'));
    } finally {
      setTrimmingVoices(false);
      setImportProgressJobs(current => current.filter(job => job.id !== jobId));
    }
  };

  const restoreVoiceTrims = () => {
    const nextVoices = voices.map(asset => {
      if (asset.sourceDurationMs === undefined) return asset;
      const { sourceDurationMs, trimStartMs: _trimStartMs, trimEndMs: _trimEndMs, ...rest } = asset;
      return { ...rest, durationMs: sourceDurationMs };
    });
    setVoices(nextVoices); rebuildAfterVoiceEdit(nextVoices);
  };

  const restoreSingleVoiceTrim = (assetId: string) => {
    const nextVoices = voices.map(asset => {
      if (asset.id !== assetId || asset.sourceDurationMs === undefined) return asset;
      const { sourceDurationMs, trimStartMs: _trimStartMs, trimEndMs: _trimEndMs, ...rest } = asset;
      return { ...rest, durationMs: sourceDurationMs };
    });
    setVoices(nextVoices); rebuildAfterVoiceEdit(nextVoices);
  };

  const addAllToTimeline = (kind: MediaKind) => {
    const requiredDurationMs = kind === 'music'
      ? durationToIncludeAllMusic(musicSequence, settings.targetDurationMs)
      : voiceScheduleDuration(scheduledVoiceSequence, settings.voiceIntervalMs, settings.allowVoiceOverlap);
    const nextSettings = requiredDurationMs > settings.targetDurationMs
      ? { ...settings, targetDurationMs: requiredDurationMs } : settings;
    if (nextSettings !== settings) setSettings(nextSettings);
    buildArrangement(nextSettings);
  };

  const changeArrangementSettings = (patch: Partial<ArrangementSettings>) => {
    player.reset();
    const nextSettings = { ...settings, ...patch };
    const nextMusicSequence = createInsertionSequence(libraryTabs.filter(tab => tab.kind === 'music'), music,
      activeMusicTabId, musicInsertion, nextSettings.seed);
    const nextVoiceSequence = createInsertionSequence(libraryTabs.filter(tab => tab.kind === 'voice'), voices,
      activeVoiceTabId, voiceInsertion, nextSettings.seed + 10_000);
    const nextScheduledVoices = nextSettings.voiceOrder === 'random'
      ? shuffleWithSeed(nextVoiceSequence, nextSettings.seed + 10_000) : nextVoiceSequence;
    if (nextSettings.durationFromVoices && nextScheduledVoices.length && ('allowVoiceOverlap' in patch || 'voicePlacement' in patch || 'voiceOrder' in patch || 'seed' in patch)) {
      nextSettings.targetDurationMs = voiceScheduleDuration(nextScheduledVoices, nextSettings.voiceIntervalMs, nextSettings.allowVoiceOverlap);
    }
    setSettings(nextSettings);
    if (!arrangement) return;
    const generated = createArrangement(nextMusicSequence, nextVoiceSequence, nextSettings);
    const next = { ...generated, voice: preserveManualVoicePositions(arrangement.voice, generated.voice, generated.durationMs) };
    setArrangement(next);
    setAutomation(current => {
      if (!current) return current;
      const clipIds = new Set(next.voice.map(clip => clip.id));
      let synced = { ...current, assignments: current.assignments.filter(item => clipIds.has(item.voiceClipId)) };
      next.voice.forEach(clip => { if (!synced.assignments.some(item => item.voiceClipId === clip.id)) synced = addAutomationAssignment(synced, clip.id); });
      return synced;
    });
  };

  const moveClip = (clipId: string, kind: TimelineClip['kind'], startMs: number, _guideMs: number | null, isolated: boolean) => {
    if (!arrangement || kind === 'missing') return;
    player.pause();
    if (kind === 'music') {
      const selected = arrangement.music.find(clip => clip.id === clipId);
      if (!selected) return;
      const anchorMs = selected.startMs;
      const deltaMs = startMs - anchorMs;
      const next = rippleMoveMusicClip(arrangement, clipId, startMs, musicSequence, settings, isolated);
      setArrangement(next);
      if (!isolated && Math.abs(deltaMs) >= 1) {
        setLibraryTabs(current => current.map(tab => !tab.localAutomationEnabled ? tab : {
          ...tab,
          automationPoints: tab.automationPoints.map(point => {
            const timeMs = point.position * arrangement.durationMs;
            const shiftedMs = timeMs >= anchorMs ? Math.max(0, timeMs + deltaMs) : timeMs;
            return { ...point, position: Math.max(0, Math.min(1, shiftedMs / next.durationMs)) };
          })
        }));
      }
      return;
    }
    setArrangement(current => {
      if (!current) return current;
      return { ...current, voice: current.voice.map(clip => clip.id === clipId ? {
        ...clip, startMs, manuallyPositioned: Math.abs(startMs - clip.generatedStartMs) > 1
      } : clip).sort((a, b) => a.startMs - b.startMs) };
    });
  };

  const removeClips = (clipIds: string[]) => {
    const ids = new Set(clipIds);
    player.pause();
    setArrangement(current => {
      if (!current) return current;
      return {
        ...current,
        music: rebuildMissingMusic(current.music.filter(item => !ids.has(item.id)), current.durationMs),
        voice: current.voice.filter(item => !ids.has(item.id))
      };
    });
    setAutomation(current => current ? {
      ...current,
      assignments: current.assignments.filter(item => !ids.has(item.voiceClipId))
    } : current);
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

  const changeClipSourceTrim = (clipId: string, sourceOffsetMs: number, durationMs: number, startMs: number) => {
    player.pause();
    setArrangement(current => current ? { ...current, voice: current.voice.map(clip => clip.id === clipId ? {
      ...clip, sourceOffsetMs, durationMs, sourceDurationMs: durationMs, startMs,
      fadeInMs: Math.min(clip.fadeInMs ?? 0, durationMs), fadeOutMs: Math.min(clip.fadeOutMs ?? 0, durationMs),
      sourceTrimManuallyAdjusted: true
    } : clip).sort((left, right) => left.startMs - right.startMs) } : current);
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
      durationMs, sourceDurationMs: asset.durationMs, sourceOffsetMs: asset.trimStartMs ?? 0,
      originalSourceDurationMs: asset.sourceDurationMs ?? asset.durationMs, color: asset.color, manuallyPositioned: true,
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
    if (tab.kind === 'music') setMusic(current => current.filter(asset => asset.libraryTabId !== id));
    else setVoices(current => current.filter(asset => asset.libraryTabId !== id));
    const remaining = libraryTabs.filter(item => item.kind === tab.kind && item.id !== id);
    setLibraryTabs(current => current.filter(item => item.id !== id));
    if (tab.kind === 'music') setActiveMusicTabId(remaining[0].id); else setActiveVoiceTabId(remaining[0].id);
    setArrangement(null); setAutomation(null);
  };

  const currentSnapshot = (): ProjectSnapshot => ({
    name: projectName, version: '0.28.0', settings, audioSettings, editingPreferences, libraryTabs,
    activeMusicTabId, activeVoiceTabId, musicInsertion, voiceInsertion, arrangement, automation, assets: allAssets,
    quarantine, importLogs
  });

  const normalizeSnapshot = (snapshot: ProjectSnapshot): ProjectSnapshot => ({
    ...snapshot,
    settings: { ...defaultSettings, ...snapshot.settings,
      musicFillMode: snapshot.settings?.musicFillMode ?? (snapshot.settings?.repeatMusic ? 'repeat' : 'silence') },
    audioSettings: { ...defaultAudioSettings, ...snapshot.audioSettings },
    editingPreferences: { ...defaultEditingPreferences, ...snapshot.editingPreferences },
    libraryTabs: snapshot.libraryTabs ?? initialTabs,
    musicInsertion: snapshot.musicInsertion?.mode === 'all' && !snapshot.musicInsertion.userSelected
      ? defaultMusicInsertion : snapshot.musicInsertion ?? defaultMusicInsertion,
    voiceInsertion: snapshot.voiceInsertion?.mode === 'all' && !snapshot.voiceInsertion.userSelected
      ? defaultVoiceInsertion : snapshot.voiceInsertion ?? defaultVoiceInsertion,
    assets: (snapshot.assets ?? []).map(asset => ({ ...asset, waveform: asset.waveform ?? [] })),
    quarantine: snapshot.quarantine ?? [], importLogs: snapshot.importLogs ?? []
  });

  const applySnapshot = (rawSnapshot: ProjectSnapshot) => {
    const snapshot = normalizeSnapshot(rawSnapshot);
    applyingHistoryRef.current = true;
    player.reset(); stopPreview();
    setMusic(snapshot.assets.filter(asset => asset.kind === 'music'));
    setVoices(snapshot.assets.filter(asset => asset.kind === 'voice'));
    setSettings(snapshot.settings); setAudioSettings(snapshot.audioSettings); setEditingPreferences(snapshot.editingPreferences);
    setLibraryTabs(snapshot.libraryTabs); setActiveMusicTabId(snapshot.activeMusicTabId); setActiveVoiceTabId(snapshot.activeVoiceTabId);
    setMusicInsertion(snapshot.musicInsertion); setVoiceInsertion(snapshot.voiceInsertion);
    setArrangement(snapshot.arrangement); setAutomation(snapshot.automation);
    setQuarantine(snapshot.quarantine); setImportLogs(snapshot.importLogs);
  };

  const undoProject = () => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    applySnapshot(historyRef.current[historyIndexRef.current]);
    setIsDirty(snapshotSignature(historyRef.current[historyIndexRef.current]) !== savedSignatureRef.current);
    setHistoryRevision(value => value + 1);
  };

  const redoProject = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    applySnapshot(historyRef.current[historyIndexRef.current]);
    setIsDirty(snapshotSignature(historyRef.current[historyIndexRef.current]) !== savedSignatureRef.current);
    setHistoryRevision(value => value + 1);
  };

  const projectDocument = (): ProjectDocument => {
    const snapshot = currentSnapshot();
    const entries = [...historyRef.current];
    if (historyIndexRef.current >= 0) entries[historyIndexRef.current] = snapshot;
    return { ...snapshot, history: { entries, index: historyIndexRef.current } };
  };

  const saveProject = async (saveAs = false): Promise<boolean> => {
    if (!window.francisDesktop || isSaving) return false;
    setIsSaving(true);
    try {
      const document = projectDocument();
      const savedPath = await window.francisDesktop.saveProject(document, saveAs ? undefined : projectPath);
      if (savedPath) {
        setProjectPath(savedPath);
        const fileName = savedPath.split(/[\\/]/).pop()?.replace(/\.francis$/i, '');
        if (fileName) setProjectName(fileName);
        savedSignatureRef.current = snapshotSignature(document);
        setIsDirty(false);
        return true;
      }
      return false;
    } catch {
      setError(t('projectSaveError'));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const confirmCanReplaceProject = async () => {
    if (!isDirty) return true;
    const choice = await window.francisDesktop?.confirmUnsavedChanges(i18n.language);
    if (choice === 'discard') return true;
    if (choice === 'save') return saveProject(false);
    return false;
  };

  const openProject = async (requestedPath?: string) => {
    if (!window.francisDesktop) return;
    try {
      if (!await confirmCanReplaceProject()) return;
      const opened = await window.francisDesktop.openProject(requestedPath);
      if (!opened) return;
      const project = opened.project as ProjectDocument;
      const openedSnapshot = normalizeSnapshot(project);
      const projectAssets = openedSnapshot.assets;
      const hydrationGeneration = ++waveformHydrationGeneration.current;
      player.reset(); stopPreview();
      assetsRef.current.filter(asset => asset.previewUrl.startsWith('blob:')).forEach(asset => URL.revokeObjectURL(asset.previewUrl));
      setMusic(projectAssets.filter(asset => asset.kind === 'music'));
      setVoices(projectAssets.filter(asset => asset.kind === 'voice'));
      setSettings(openedSnapshot.settings); setAudioSettings(openedSnapshot.audioSettings); setEditingPreferences(openedSnapshot.editingPreferences);
      setLibraryTabs(openedSnapshot.libraryTabs); setActiveMusicTabId(openedSnapshot.activeMusicTabId); setActiveVoiceTabId(openedSnapshot.activeVoiceTabId);
      setMusicInsertion(openedSnapshot.musicInsertion); setVoiceInsertion(openedSnapshot.voiceInsertion);
      setArrangement(openedSnapshot.arrangement); setAutomation(openedSnapshot.automation);
      setQuarantine(openedSnapshot.quarantine); setImportLogs(openedSnapshot.importLogs);
      setProjectPath(opened.projectPath); setProjectName(project.name);
      const restoredEntries = project.history?.entries?.length
        ? project.history.entries.map(normalizeSnapshot) : [openedSnapshot];
      const restoredIndex = Math.max(0, Math.min(project.history?.index ?? restoredEntries.length - 1, restoredEntries.length - 1));
      restoredEntries[restoredIndex] = openedSnapshot;
      historyRef.current = restoredEntries; historyIndexRef.current = restoredIndex;
      historyReadyRef.current = true; applyingHistoryRef.current = true;
      savedSignatureRef.current = snapshotSignature(openedSnapshot); setIsDirty(false);
      setHistoryRevision(value => value + 1);
      if (window.francisDesktop?.preparePreviews) void window.francisDesktop.preparePreviews(projectAssets.map(asset => asset.path)).catch(() => undefined);
      const missingWaveforms = projectAssets.filter(asset => asset.waveform.length < 2048);
      if (missingWaveforms.length && window.francisDesktop?.generateWaveforms) {
        setImportProgressJobs(current => [...current.filter(job => job.id !== 'background-analysis'), {
          id: 'background-analysis', label: t('analyzingFiles'), completed: 0, total: missingWaveforms.length
        }]);
        void window.francisDesktop.generateWaveforms(missingWaveforms.map(asset => asset.path)).then(generated => {
          if (waveformHydrationGeneration.current !== hydrationGeneration) return;
          const byPath = new Map(generated.map(item => [item.path, item.waveform]));
          const hydrate = (assets: MediaAsset[]) => assets.map(asset => byPath.has(asset.path)
            ? { ...asset, waveform: byPath.get(asset.path) ?? [] } : asset);
          setMusic(hydrate); setVoices(hydrate);
        }).finally(() => {
          if (waveformHydrationGeneration.current === hydrationGeneration) {
            setImportProgressJobs(current => current.filter(job => job.id !== 'background-analysis'));
          }
        });
      }
    } catch {
      setError(t('projectOpenError'));
    }
  };

  const clearProject = () => {
    waveformHydrationGeneration.current += 1;
    player.reset(); stopPreview();
    assetsRef.current.filter(asset => asset.previewUrl.startsWith('blob:')).forEach(asset => URL.revokeObjectURL(asset.previewUrl));
    setMusic([]); setVoices([]); setLibraryTabs(initialTabs.map(tab => ({ ...tab, automationPoints: [] })));
    setActiveMusicTabId('music-1'); setActiveVoiceTabId('voice-1'); setArrangement(null); setAutomation(null);
    setQuarantine([]); setImportLogs([]); setProjectPath(undefined); setProjectName(t('untitledProject'));
    setSettings(defaultSettings); setAudioSettings(defaultAudioSettings); setEditingPreferences(defaultEditingPreferences);
    setMusicInsertion(defaultMusicInsertion); setVoiceInsertion(defaultVoiceInsertion);
    historyRef.current = []; historyIndexRef.current = -1; historyReadyRef.current = false;
    applyingHistoryRef.current = false; savedSignatureRef.current = ''; setIsDirty(false);
    setHistoryRevision(value => value + 1);
  };

  const newProject = async () => {
    if (await confirmCanReplaceProject()) clearProject();
  };

  const exportAudio = async (exportSettings: ExportSettings) => {
    if (!window.francisDesktop || !arrangement) return null;
    return window.francisDesktop.exportAudio(projectDocument(), exportSettings);
  };

  const changeAudioSettings = (patch: Partial<AudioSettings>) => {
    const normalized = { ...patch };
    if (patch.fadeDownMs !== undefined) normalized.fadeDownOverlapMs = Math.min(
      patch.fadeDownMs, patch.fadeDownOverlapMs ?? audioSettings.fadeDownOverlapMs ?? 0
    );
    if (patch.fadeUpMs !== undefined) normalized.fadeUpOverlapMs = Math.min(
      patch.fadeUpMs, patch.fadeUpOverlapMs ?? audioSettings.fadeUpOverlapMs ?? 0
    );
    setAudioSettings(current => ({ ...current, ...normalized }));
    setAutomation(current => current ? syncDefaultAutomationGroups(current, normalized) : current);
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
  };

  useEffect(() => {
    const snapshot = currentSnapshot();
    const signature = snapshotSignature(snapshot);
    if (!historyReadyRef.current) {
      historyRef.current = [snapshot]; historyIndexRef.current = 0; historyReadyRef.current = true;
      savedSignatureRef.current = signature; setIsDirty(false); setHistoryRevision(value => value + 1);
      return;
    }
    if (applyingHistoryRef.current) {
      applyingHistoryRef.current = false;
      return;
    }
    const current = historyRef.current[historyIndexRef.current];
    if (current && snapshotSignature(current) === signature) return;
    historyRef.current = [...historyRef.current.slice(0, historyIndexRef.current + 1), snapshot];
    historyIndexRef.current = historyRef.current.length - 1;
    setIsDirty(signature !== savedSignatureRef.current);
    setHistoryRevision(value => value + 1);
  }, [settings, audioSettings, editingPreferences, libraryTabs, activeMusicTabId, activeVoiceTabId,
    musicInsertion, voiceInsertion, arrangement, automation, allAssets, quarantine, importLogs]);

  useEffect(() => {
    const removeListener = window.francisDesktop?.onOpenProject(path => { void openProject(path); });
    const removeMenuListener = window.francisDesktop?.onMenuCommand(command => {
      if (command === 'new') void newProject();
      if (command === 'open') void openProject();
      if (command === 'save') void saveProject(false);
      if (command === 'saveAs') void saveProject(true);
      if (command === 'undo') undoProject();
      if (command === 'redo') redoProject();
      if (command === 'quarantine') setQuarantineOpen(true);
      if (command === 'importLog') setImportLogOpen(true);
      if (command === 'export' && arrangement) setExportOpen(true);
    });
    return () => { removeListener?.(); removeMenuListener?.(); };
  });

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><BrandMark /><div><h1>Francis Player</h1><p>{t('appSubtitle')}</p></div></div>
      <div className="project-state"><span className="draft-pill">{t(isSaving ? 'statusSaving' : isDirty ? 'statusDirty' : projectPath ? 'statusSaved' : 'statusDraft')}</span><div><strong>{projectName}</strong><small>{status}</small></div></div>
      <nav className="project-actions">
        <button onClick={() => void newProject()} disabled={isSaving} title={t('newProjectAction')}><ProjectActionIcon type="new" /></button>
        <button onClick={() => void openProject()} disabled={isSaving} title={`${t('openProject')} · Ctrl/⌘O`}><ProjectActionIcon type="open" /></button>
        <button onClick={() => void saveProject(false)} disabled={isSaving} title={`${t('saveProject')} · Ctrl/⌘S`}><ProjectActionIcon type="save" /></button>
        <button onClick={() => void saveProject(true)} disabled={isSaving} title={t('saveProjectAs')}><ProjectActionIcon type="saveAs" /></button>
        <button className={`problem-files-action ${quarantine.length ? 'attention' : ''}`} onClick={() => setQuarantineOpen(true)}
          title={t('problemFiles')} aria-label={`${t('problemFiles')}: ${quarantine.length}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 21 20H3z" /><path d="M12 9v5M12 17.25v.25" /></svg>
          <span>{quarantine.length}</span>
        </button>
        <button onClick={() => setImportLogOpen(true)} title={t('importLog')}>☷ {importLogs.length}</button>
        <button className="export-nav" onClick={() => setExportOpen(true)} disabled={!arrangement} title={t('exportMix')}>{t('export')}</button>
      </nav>
      <div className="language-switch" aria-label={t('language')}>
        <button className={i18n.language === 'es' ? 'active' : ''} onClick={() => void i18n.changeLanguage('es')}>{t('spanish')}</button>
        <button className={i18n.language === 'en' ? 'active' : ''} onClick={() => void i18n.changeLanguage('en')}>{t('english')}</button>
      </div>
    </header>

    <main className={settingsCollapsed ? 'settings-collapsed' : ''}>
      <div className="workspace-grid">
        <div className="library-area">
          <AssetList kind="music" assets={music} tabs={libraryTabs.filter(tab => tab.kind === 'music')}
            activeTabId={activeMusicTabId} insertion={musicInsertion} activePreview={activePreview} occurrences={occurrences}
            allowAssetReuse={editingPreferences.allowAssetReuse} showFileLoudness={editingPreferences.showFileLoudness} audioSettings={audioSettings} onFiles={addFiles}
            onRemove={removeAsset} onPreview={(asset) => void preview(asset)} onAddAll={() => addAllToTimeline('music')}
            onRestoreTrim={() => undefined}
            onSelectTab={setActiveMusicTabId} onAddTab={addLibraryTab}
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
            allowAssetReuse={editingPreferences.allowAssetReuse} showFileLoudness={editingPreferences.showFileLoudness} audioSettings={audioSettings} onFiles={addFiles}
            onRemove={removeAsset} onPreview={(asset) => void preview(asset)} onAddAll={() => addAllToTimeline('voice')}
            onRestoreTrim={restoreSingleVoiceTrim}
            onSelectTab={setActiveVoiceTabId} onAddTab={addLibraryTab}
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
        <SettingsPanel settings={settings} audioSettings={audioSettings} automation={automation} editingPreferences={editingPreferences}
          voiceAssets={scheduledVoiceSequence}
          onChange={changeArrangementSettings}
          onAudioChange={changeAudioSettings}
          onAutomationChange={setAutomation}
          onEditingPreferencesChange={(patch) => setEditingPreferences(current => ({ ...current, ...patch }))}
          trimmingVoices={trimmingVoices}
          onTrimVoices={() => void trimAllVoices()}
          onRestoreVoiceTrims={restoreVoiceTrims}
          collapsed={settingsCollapsed}
          onToggleCollapsed={() => setSettingsCollapsed(current => !current)} />
      </div>
      <Timeline arrangement={arrangement} tabs={libraryTabs} assets={allAssets} isPlaying={player.isPlaying || player.isPreparing} positionMs={player.positionMs}
        musicGainDb={player.musicGainDb} meter={player.meter} automation={automation} editingPreferences={editingPreferences}
        canMount={music.length + voices.length > 0} onMount={mount}
        onAutomationChange={setAutomation}
        onEditingPreferencesChange={(patch) => setEditingPreferences(current => ({ ...current, ...patch }))}
        onMoveClip={moveClip} onRemoveClips={removeClips} onFadeChange={changeClipFade} onSourceTrimChange={changeClipSourceTrim}
        onTabChange={updateLibraryTab} onDropAsset={dropAsset}
        onPlay={() => { stopPreview(); player.play(); }}
        onPause={player.pause} onSeek={player.seek} />
    </main>
    <ExportDialog open={exportOpen} canExport={Boolean(arrangement && allAssets.length)} onClose={() => setExportOpen(false)} onExport={exportAudio}
      onSeek={(positionMs) => { player.seek(positionMs); setExportOpen(false); }} />
    <QuarantineDialog open={quarantineOpen} items={quarantine} onClose={() => setQuarantineOpen(false)} onAdmit={admitFromQuarantine} />
    <ImportLogDialog open={importLogOpen} logs={importLogs} onClose={() => setImportLogOpen(false)} />
    {(error || importProgressJobs.length > 0) && <div className="toast-stack" aria-live="polite">
      {error && <div className="app-toast error-toast"><strong>{t('warning')}</strong>
        <button onClick={() => setError(null)} aria-label={t('close')}>×</button><span>{error}</span></div>}
      {importProgressJobs.map(job => <div className="app-toast import-progress-toast" key={job.id}><strong>{job.label}</strong>
        <span>{job.completed} / {job.total}</span><i><b style={{ width: `${job.total ? job.completed / job.total * 100 : 0}%` }} /></i></div>)}
    </div>}
  </div>;
}
