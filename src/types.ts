export type MediaKind = 'music' | 'voice';
export type OrderMode = 'sequential' | 'random';
export type VoicePlacement = 'interval' | 'uniform';
export type SnapMode = 'smart' | 'grid' | 'edges' | 'original';
export type InsertionMode = 'balanced' | 'active' | 'all' | 'roundRobin' | 'random' | 'custom';

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
  userSelected?: boolean;
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
  sourceDurationMs?: number;
  trimStartMs?: number;
  trimEndMs?: number;
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
  fadeDownOverlapMs?: number;
  fadeUpOverlapMs?: number;
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
  offsetMs?: number;
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

export interface AutomationPresetTemplate {
  displayUnit: AutomationDisplayUnit;
  visible: boolean;
  groups: Array<Omit<AutomationGroup, 'id'>>;
  assignments: Array<{
    highGroup: number;
    lowGroup: number;
    fadeDownGroup: number;
    fadeUpGroup: number;
  }>;
}

export interface ConfigurationPreset {
  format: 'francis-player-configuration-preset';
  formatVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: ArrangementSettings;
  audioSettings: AudioSettings;
  editingPreferences: EditingPreferences;
  musicInsertion: InsertionConfig;
  voiceInsertion: InsertionConfig;
  automation: AutomationPresetTemplate | null;
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
  sourceOffsetMs?: number;
  originalSourceDurationMs?: number;
  sourceTrimManuallyAdjusted?: boolean;
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
  transportSkipSeconds: number;
  allowAssetReuse: boolean;
  verifyFileIntegrity: boolean;
  analyzeLoudnessOnImport: boolean;
  showFileLoudness: boolean;
  automationDisplayUnit: AutomationDisplayUnit;
  showAutomations: boolean;
  mixEditorMode: 'values' | 'graphic';
  trimSilenceEnabled: boolean;
  trimSilenceThresholdDb: number;
  trimSilencePaddingMs: number;
  trimSilenceMinimumMs: number;
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
  verifyOutput: boolean;
  detectSilence: boolean;
  silenceThresholdDb: number;
  silenceMinimumMs: number;
}

export type ExportPhase = 'preflight' | 'rendering' | 'encoding' | 'verifying' | 'publishing' | 'complete';

export interface ExportProgress {
  phase: ExportPhase;
  percent: number;
  detail?: string;
}

export interface ExportSilenceIssue {
  startMs: number;
  endMs: number;
  durationMs: number;
  beforeClip?: string;
  afterClip?: string;
}

export interface ExportCheck {
  id: string;
  status: 'passed' | 'warning' | 'failed';
  label: string;
  detail: string;
  detailKey?: string;
  detailParams?: Record<string, string | number>;
}

export interface ExportReport {
  verified: boolean;
  createdAt: string;
  outputPath: string;
  durationMs: number;
  expectedDurationMs: number;
  format: string;
  channels: number;
  sampleRate: number;
  clipCount: number;
  musicClipCount: number;
  voiceClipCount: number;
  automationCount: number;
  fileSha256: string;
  decodedPcmSha256: string;
  masterPcmSha256: string;
  integratedLufs?: number;
  loudnessRangeLu?: number;
  truePeakDbtp?: number;
  samplePeakDb?: number;
  rmsDb?: number;
  differenceRmsDb?: number;
  differencePeakDb?: number;
  silenceIssues: ExportSilenceIssue[];
  checks: ExportCheck[];
}

export interface ExportResult {
  outputPath: string;
  reportPath: string;
  report: ExportReport;
}
