export type MediaKind = 'music' | 'voice';
export type OrderMode = 'sequential' | 'random';
export type VoicePlacement = 'interval' | 'uniform';

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  name: string;
  durationMs: number;
  sizeBytes: number;
  path: string;
  previewUrl: string;
  color: string;
}

export interface ArrangementSettings {
  targetDurationMs: number;
  musicOrder: OrderMode;
  voiceOrder: OrderMode;
  repeatMusic: boolean;
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
}

export interface TimelineClip {
  id: string;
  assetId?: string;
  kind: MediaKind | 'missing';
  name: string;
  startMs: number;
  durationMs: number;
  sourceDurationMs?: number;
  color: string;
  truncated?: boolean;
}

export interface Arrangement {
  durationMs: number;
  music: TimelineClip[];
  voice: TimelineClip[];
  warnings: string[];
}
