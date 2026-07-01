export type ChannelProbeState = 'idle' | 'running' | 'done' | 'error';

export interface IptvPickerCoreChannelEntry {
  bareUrl: string;
  ok: boolean;
  engine: 'iptv-checker' | 'ffprobe-fast';
  checkedAt: string;
  errorCode?: string;
  errorMessage?: string;
  resolution?: string | null;
  codec?: string | null;
  bitrate?: number | null;
  fps?: number | null;
  formatName?: string | null;
  sourceUrl?: string;
  sourceName?: string;
  channel?: string;
  group?: string;
  curationQuality?: 'preferred' | 'fallback' | 'low-res-fallback' | 'unknown';
  curationQualityLabel?: string;
}

export type IptvPickerCoreChannelMap = Record<string, IptvPickerCoreChannelEntry>;

export interface IptvPickerCoreSourceSummary {
  sourceUrl: string;
  sourceName: string;
  totalUrls: number;
  okUrls: number;
  failedUrls: number;
  formatErrors: number;
  templateMatchedChannels: number;
  checkedAt: string;
}

export interface IptvPickerCoreReport {
  generatedAt: string;
  totalSources: number;
  totalUrls: number;
  okUrls: number;
  failedUrls: number;
  formatErrors: number;
  sources: IptvPickerCoreSourceSummary[];
}

export type ChannelCurationPreset = 'none' | 'cn' | 'cn-full' | 'cn-plus';

export interface ChannelCurationChannelSummary {
  key: string;
  label: string;
  group: string;
  candidates: number;
  kept: number;
  bestScore: number;
  conflictRejected?: number;
}

export interface ChannelCurationSummary {
  preset: ChannelCurationPreset;
  keepPerChannel: number;
  preferredMinHeight?: number;
  fallbackMinHeight?: number;
  allowLowResFallback?: boolean;
  preferredKept?: number;
  fallbackKept?: number;
  lowResFallbackKept?: number;
  targets: number;
  matchedTargets: number;
  missingTargets: number;
  candidates: number;
  kept: number;
  conflictRejected?: number;
  groups: ChannelCurationChannelSummary[];
  missing: string[];
}

export interface IptvPickerCoreStatus {
  state: ChannelProbeState;
  enabled: boolean;
  ffprobeAvailable: boolean;
  nodeSupported: boolean;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  totalSources: number;
  checkedSources: number;
  totalUrls: number;
  checkedUrls: number;
  okUrls: number;
  failedUrls: number;
  currentSourceName?: string;
  currentSourceUrl?: string;
  currentSourceIndex?: number;
  currentSourceStartedAt?: string;
  currentSourceElapsedMs?: number;
  lastFinishedSourceName?: string;
  lastFinishedSourceUrl?: string;
  lastFinishedSourceDurationMs?: number;
  lastFinishedSourceDownloadMs?: number;
  lastFinishedSourceParseMs?: number;
  lastFinishedSourceCurationMs?: number;
  lastFinishedSourcePreflightMs?: number;
  lastFinishedSourceLintMs?: number;
  lastFinishedSourceCheckMs?: number;
  error?: string;
}
