export type MediaKind = 'music' | 'voice';
export type OrderMode = 'sequential' | 'random';
export type VoicePlacement = 'interval' | 'uniform';
export type SnapMode = 'smart' | 'grid' | 'edges' | 'original';
export type InsertionMode = 'active' | 'all' | 'roundRobin' | 'random' | 'custom';

export interface LibraryTab {
  id: string;
  kind: MediaKind;
  name: string;
  color: string;
  localAutomationEnabled: boolean;
  automationPoints: TrackAutomationPoint[];
}

export interface TrackAutomationPoint {
  id: string;
  position: number;
  value: number;
}

export interface InsertionConfig {
  mode: InsertionMode;
  customPattern: string;
}

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  name: string;
  durationMs: number;
  sizeBytes: number;
  path: string;
  previewUrl: string;
  color: string;
  libraryTabId: string;
  waveform: number[];
  fingerprint?: string;
  integrity?: 'unchecked' | 'valid' | 'warning';
  analysis?: AudioAnalysis;
}

export interface AudioAnalysis {
  integratedLufs: number;
  loudnessRangeLu: number;
  truePeakDbtp: number;
  samplePeakDb: number;
  rmsDb: number;
  recommendedGainDb: number;
  analyzedAt: string;
}

export interface ArrangementSettings {
  targetDurationMs: number;
  durationFromVoices?: boolean;
  musicOrder: OrderMode;
  voiceOrder: OrderMode;
  repeatMusic: boolean;
  musicFillMode?: 'silence' | 'repeat' | 'random';
  voicePlacement: VoicePlacement;
  voiceIntervalMs: number;
  allowVoiceOverlap: boolean;
  seed: number;
}

export interface AudioSettings {
  musicGainDb: number;
  voiceGainDb: number;
  duckingGainDb: number;
  fadeDownMs: number;
  fadeUpMs: number;
  normalizeClips?: boolean;
  normalizationTargetLufs?: number;
  truePeakCeilingDbtp?: number;
  echoEnabled?: boolean;
  echoDelayMs?: number;
  echoFeedback?: number;
  echoMix?: number;
  reverbEnabled?: boolean;
  reverbDuration?: number;
  reverbDecay?: number;
  reverbMix?: number;
}

export interface LoudnessMeterReading {
  momentary: number;
  shortTerm: number;
  integrated: number;
  peakDbfs: number;
}

export type AutomationDisplayUnit = 'percent' | 'db';
export type AutomationGroupType = 'high' | 'low' | 'fadeDown' | 'fadeUp';

export interface AutomationGroup {
  id: string;
  type: AutomationGroupType;
  index: number;
  value: number;
  color: string;
}

export interface AutomationAssignment {
  voiceClipId: string;
  highGroupId: string;
  lowGroupId: string;
  fadeDownGroupId: string;
  fadeUpGroupId: string;
}

export interface AutomationState {
  displayUnit: AutomationDisplayUnit;
  visible: boolean;
  groups: AutomationGroup[];
  assignments: AutomationAssignment[];
}

export interface TimelineClip {
  id: string;
  assetId?: string;
  kind: MediaKind | 'missing';
  name: string;
  startMs: number;
  generatedStartMs: number;
  durationMs: number;
  sourceDurationMs?: number;
  color: string;
  truncated?: boolean;
  manuallyPositioned?: boolean;
  libraryTabId?: string;
  fadeInMs?: number;
  fadeOutMs?: number;
}

export interface Arrangement {
  durationMs: number;
  music: TimelineClip[];
  voice: TimelineClip[];
  warnings: string[];
}

export interface EditingPreferences {
  snapEnabled: boolean;
  snapMode: SnapMode;
  snapGridMs: number;
  allowAssetReuse: boolean;
  verifyFileIntegrity: boolean;
  analyzeLoudnessOnImport: boolean;
  showFileLoudness: boolean;
  automationDisplayUnit: AutomationDisplayUnit;
  showAutomations: boolean;
  mixEditorMode: 'values' | 'graphic';
}

export interface QuarantineItem {
  id: string;
  kind: MediaKind;
  name: string;
  path: string;
  previewUrl: string;
  sizeBytes: number;
  durationMs: number;
  fingerprint: string;
  reason: 'unsupported' | 'corrupt' | 'unreadable' | 'invalidDuration';
  detail: string;
  importedAt: string;
}

export interface ImportLogEntry {
  path: string;
  name: string;
  outcome: 'imported' | 'quarantined' | 'duplicate';
  detail: string;
}

export interface ImportLog {
  id: string;
  startedAt: string;
  finishedAt: string;
  sourceCount: number;
  importedCount: number;
  quarantinedCount: number;
  duplicateCount: number;
  entries: ImportLogEntry[];
}

export interface ExportSettings {
  format: 'wav' | 'mp3' | 'aac' | 'flac' | 'ogg' | 'opus';
  channels: 1 | 2;
  sampleRate: 44100 | 48000 | 96000;
  bitDepth: 16 | 24 | 32;
  bitrate: 96 | 128 | 192 | 256 | 320;
  compressionLevel: number;
  normalize: boolean;
}
