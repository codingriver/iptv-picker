import { execFile, spawn } from 'child_process';
import { createHash } from 'crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { createRequire } from 'module';
import { gunzipSync } from 'zlib';
import { homedir, tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { promisify } from 'util';
import type {
  IptvPickerCoreChannelEntry,
  ChannelCurationSummary,
  IptvPickerCoreReport,
  IptvPickerCoreSourceSummary,
  IptvPickerCoreStatus,
  ChannelCurationPreset,
} from './types';
import { githubRequestUrls, TVBOX_UA } from './config';
import { createChannelNameMatcher } from './channel-curation';
import { getBundledFfprobeAsset } from './bundled-ffprobe';

export interface IptvPickerCoreInputSource {
  name: string;
  url: string;
  content?: string;
  sourceKind?: 'candidate' | 'manual' | 'config' | 'custom';
}

export type IptvPickerCoreCheckMode = 'full' | 'fast';
export type IptvPickerCorePipelineMode = 'source' | 'stage';

export interface IptvPickerCoreRuntimeOptions {
  downloadTimeoutMs?: number;
  checkTimeoutMs?: number;
  checkRetry?: number;
  checkMode?: IptvPickerCoreCheckMode;
  requireFfmpeg?: boolean;
  ffprobePath?: string;
  preflight?: boolean;
  preflightTimeoutMs?: number;
  hostTimeoutLimit?: number;
  sourceParallel?: number;
  preflightParallel?: number;
  preflightHostParallel?: number;
  checkParallel?: number;
  checkHostParallel?: number;
  pipelineMode?: IptvPickerCorePipelineMode;
  preflightCheckpointPath?: string;
  resumePreflightPath?: string;
  preCheckCuration?: {
    enabled: boolean;
    preset: ChannelCurationPreset;
    targetsFilePath?: string;
    aliasesFilePath?: string;
  };
  onDetailLog?: (event: IptvPickerCoreDetailLogEvent) => void;
}

export interface IptvPickerCoreProgressEvent {
  status: IptvPickerCoreFileResult['status'];
  sourceEntries?: IptvPickerCoreChannelEntry[];
  sourceTiming?: NonNullable<IptvPickerCoreFileResult['timing']>['sources'][number];
  allEntries?: IptvPickerCoreChannelEntry[];
}

export interface IptvPickerCoreDetailLogEvent {
  type: string;
  fields: Record<string, string | number | boolean | null | undefined>;
}

type NormalizedIptvPickerCoreRuntimeOptions = Omit<Required<IptvPickerCoreRuntimeOptions>, 'preCheckCuration' | 'onDetailLog' | 'preflightCheckpointPath' | 'resumePreflightPath' | 'ffprobePath'> & {
  preCheckCuration?: IptvPickerCoreRuntimeOptions['preCheckCuration'];
  onDetailLog?: IptvPickerCoreRuntimeOptions['onDetailLog'];
  preflightCheckpointPath?: string;
  resumePreflightPath?: string;
  ffprobePath?: string;
  preflightHostState: Map<string, { timeoutCount: number; blocked: boolean }>;
  ffprobeAvailable: boolean;
  ffprobeSource?: 'env' | 'bundled' | 'local-bin' | 'path';
  noFfmpegMode: boolean;
};

export interface IptvPickerCoreFileResult {
  generatedAt: string;
  runtime?: {
    nodeSupported: boolean;
    ffprobeAvailable: boolean;
    ffprobePath?: string;
    ffprobeSource?: 'env' | 'bundled' | 'local-bin' | 'path';
    noFfmpegMode: boolean;
    requireFfmpeg: boolean;
    checkMode: IptvPickerCoreCheckMode;
    playbackValidation: 'ffmpeg' | 'no-ffmpeg';
  };
  status: Omit<IptvPickerCoreStatus, 'enabled' | 'ffprobeAvailable' | 'nodeSupported'>;
  report: IptvPickerCoreReport;
  entries: IptvPickerCoreChannelEntry[];
  timing?: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    totals: {
      downloadMs: number;
      parseMs: number;
      curationMs: number;
      preflightMs: number;
      lintMs: number;
      checkMs: number;
    };
    sources: Array<{
      sourceName: string;
      sourceUrl: string;
      startedAt: string;
      finishedAt: string;
      durationMs: number;
      downloadMs: number;
      parseMs: number;
      curationMs: number;
      preflightMs: number;
      lintMs: number;
      checkMs: number;
      rawGroups?: number;
      rawChannels?: number;
      rawUrls?: number;
      matchedGroups?: number;
      matchedChannels?: number;
      matchedUrls?: number;
      templateDroppedUrls?: number;
      preflightInputUrls?: number;
      preflightPassedUrls?: number;
      preflightFailedUrls?: number;
      preflightSkippedUrls?: number;
      entries: number;
      okEntries: number;
      failedEntries: number;
      lintErrors: number;
      downloadFailed: boolean;
    }>;
  };
  pipeline?: {
    inputMode: 'url' | 'input';
    inputFile?: string;
    rawSources: number;
    loadedSources: number;
    droppedSources: number;
    checkedSources: number;
    rawEntries: number;
    okEntries: number;
    failedEntries: number;
    outputEntries: number;
    steps: Array<{
      name: string;
      input: number;
      output: number;
      lost: number;
      lossRate: number;
      startedAt?: string;
      finishedAt?: string;
      durationMs?: number;
      note?: string;
    }>;
    errorCodes: Array<{ code: string; count: number }>;
    generatedTextReport?: string;
  };
  output?: {
    filtered: boolean;
    filters: {
      status: 'all' | 'ok' | 'failed';
      source?: string;
      group?: string;
      channel?: string;
      errorCode?: string;
      minHeight?: number;
    };
    sort: string;
    sortDir: 'asc' | 'desc';
    reportSort?: string;
    reportSortDir?: 'asc' | 'desc';
    strategy?: string;
    runtime?: {
      downloadTimeoutMs: number;
      checkTimeoutMs: number;
      checkRetry: number;
      checkMode: IptvPickerCoreCheckMode;
      requireFfmpeg?: boolean;
      ffprobeAvailable?: boolean;
      ffprobePath?: string;
      ffprobeSource?: 'env' | 'bundled' | 'local-bin' | 'path';
      noFfmpegMode?: boolean;
      playbackValidation?: 'ffmpeg' | 'no-ffmpeg';
      preflight: boolean;
      preflightTimeoutMs: number;
      hostTimeoutLimit: number;
      sourceParallel: number;
      preflightParallel: number;
      preflightHostParallel: number;
      checkParallel: number;
      checkHostParallel: number;
      pipelineMode?: IptvPickerCorePipelineMode;
      preflightCheckpointPath?: string;
      resumePreflightPath?: string;
    };
    originalEntries: number;
    outputEntries: number;
    liveExport?: {
      file: string;
      format: 'm3u' | 'txt' | 'json';
      entries: number;
      okOnly: boolean;
    };
    liveExports?: Array<{
      file: string;
      format: 'm3u' | 'txt' | 'json';
      entries: number;
      okOnly: boolean;
    }>;
    markdownReports?: {
      sourceStats?: string;
      channelStats?: string;
    };
    remotePublish?: Array<{
      type: 'webdav' | 'http-post' | 'http-get';
      name: string;
      ok: boolean;
      files: number;
      status?: number;
      target?: string;
      startedAt: string;
      finishedAt: string;
      durationMs: number;
      error?: string;
    }>;
    channelCuration?: ChannelCurationSummary;
    channelCurationPreset?: string;
    channelCurationKeepPerChannel?: number;
    channelCurationPreferredMinHeight?: number;
    channelCurationFallbackMinHeight?: number;
    channelCurationAllowLowResFallback?: boolean;
    channelCurationPreFilter?: boolean;
    channelCurationIncludeUnmatched?: boolean;
    channelCurationIncludeFailed?: boolean;
  };
}

export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15000;
export const DEFAULT_CHECK_TIMEOUT_MS = 15000;
export const DEFAULT_CHECK_RETRY = 1;
export const DEFAULT_CHECK_MODE: IptvPickerCoreCheckMode = 'full';
export const DEFAULT_PREFLIGHT = false;
export const DEFAULT_PREFLIGHT_TIMEOUT_MS = 5000;
export const DEFAULT_HOST_TIMEOUT_LIMIT = 3;
export const DEFAULT_SOURCE_PARALLEL = 1;
export const DEFAULT_PREFLIGHT_PARALLEL = 1;
export const DEFAULT_PREFLIGHT_HOST_PARALLEL = 2;
export const DEFAULT_CHECK_PARALLEL = 20;
export const DEFAULT_CHECK_HOST_PARALLEL = 1;
export const DEFAULT_PIPELINE_MODE: IptvPickerCorePipelineMode = 'stage';

interface ParsedPlaylistItem {
  name: string;
  group: string;
  url: string;
}

interface DownloadSourceResult {
  ok: boolean;
  content: string | null;
  bytes: number;
  status?: number;
  error?: string;
  durationMs: number;
  fromInline: boolean;
}

interface StageSourceWorkItem {
  source: IptvPickerCoreInputSource;
  index: number;
  totalSources: number;
  startedAt: string;
  finishedAt?: string;
  download?: DownloadSourceResult;
  content?: string;
  contentIsM3u?: boolean;
  rawItems: ParsedPlaylistItem[];
  curatedItems: ParsedPlaylistItem[];
  preflightItems: ParsedPlaylistItem[];
  preflightFailures: CheckedPlaylistItem[];
  entries: IptvPickerCoreChannelEntry[];
  lintErrors: number;
  rawStats: { groups: number; channels: number; urls: number };
  curatedStats: { groups: number; channels: number; urls: number };
  preflightSkipped: number;
  downloadFailed: boolean;
  timing: {
    downloadMs: number;
    parseMs: number;
    curationMs: number;
    preflightMs: number;
    lintMs: number;
    checkMs: number;
  };
}

interface PreflightCheckpointFile {
  schemaVersion: 1;
  state: 'preflight_running' | 'preflight_done';
  generatedAt: string;
  fingerprint: string;
  runtime: {
    checkMode: IptvPickerCoreCheckMode;
    preflight: boolean;
    preflightTimeoutMs: number;
    hostTimeoutLimit: number;
    sourceParallel: number;
    preflightParallel: number;
    preflightHostParallel: number;
    checkParallel: number;
    checkHostParallel: number;
  };
  sources: Array<{
    index: number;
    totalSources: number;
    sourceName: string;
    sourceUrl: string;
    startedAt: string;
    finishedAt?: string;
    downloadFailed: boolean;
    lintErrors: number;
    rawStats: { groups: number; channels: number; urls: number };
    curatedStats: { groups: number; channels: number; urls: number };
    preflightStats: { input: number; passed: number; failed: number; skipped: number };
    timing: StageSourceWorkItem['timing'];
    entriesBeforeCheck: IptvPickerCoreChannelEntry[];
    passedItems: ParsedPlaylistItem[];
    failedItems: CheckedPlaylistItem[];
  }>;
}

const DEFAULT_STATUS: IptvPickerCoreStatus = {
  state: 'idle',
  enabled: false,
  ffprobeAvailable: false,
  nodeSupported: false,
  totalSources: 0,
  checkedSources: 0,
  totalUrls: 0,
  checkedUrls: 0,
  okUrls: 0,
  failedUrls: 0,
};

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : fallback;
}

const LINTER_RULES = {
  'no-empty-lines': false,
  'require-header': true,
  'attribute-quotes': true,
  'require-info': true,
  'require-title': true,
  'no-trailing-spaces': false,
  'no-whitespace-before-title': true,
  'no-multi-spaces': false,
  'no-extra-comma': true,
  'space-before-paren': false,
  'no-dash': false,
  'require-link': true,
};

const nodeRequire = createRequire(__filename);
const execFileAsync = promisify(execFile);

function stripLiveUrlSource(value: string): string {
  const idx = value.lastIndexOf('$');
  return idx <= 0 ? value : value.slice(0, idx);
}

function nodeSupported(): boolean {
  const [major, minor] = process.versions.node.split('.').map((value) => Number(value));
  return major > 22 || (major === 22 && minor >= 12);
}

function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ['-version'], { stdio: 'ignore', windowsHide: true });
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
  });
}

function executableName(base: string): string {
  return process.platform === 'win32' ? `${base}.exe` : base;
}

function pathDelimiter(): string {
  return process.platform === 'win32' ? ';' : ':';
}

function prependProcessPath(dir: string): void {
  const key = process.platform === 'win32' ? 'Path' : 'PATH';
  const envKey = Object.keys(process.env).find((item) => item.toLowerCase() === key.toLowerCase()) || key;
  const current = process.env[envKey] || '';
  const parts = current.split(pathDelimiter()).filter(Boolean);
  if (!parts.some((item) => item.toLowerCase() === dir.toLowerCase())) {
    process.env[envKey] = [dir, ...parts].join(pathDelimiter());
  }
}

function bundledCacheRoot(): string {
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA || process.env.APPDATA || join(homedir(), 'AppData', 'Local');
  }
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches');
  return process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
}

function ensureBundledFfprobe(): string | undefined {
  const asset = getBundledFfprobeAsset();
  if (!asset) return undefined;
  if (asset.platform !== process.platform || asset.arch !== process.arch) return undefined;
  const versionKey = asset.sha256.slice(0, 16);
  const dir = join(bundledCacheRoot(), 'iptv-picker', 'bin', 'ffprobe', `${asset.platform}-${asset.arch}-${versionKey}`);
  const file = join(dir, asset.filename || executableName('ffprobe'));
  try {
    if (existsSync(file)) {
      const current = createHash('sha256').update(readFileSync(file)).digest('hex');
      if (current === asset.sha256) return file;
    }
    mkdirSync(dir, { recursive: true });
    const bytes = gunzipSync(Buffer.from(asset.gzipBase64, 'base64'));
    const actualSha = createHash('sha256').update(bytes).digest('hex');
    if (actualSha !== asset.sha256) throw new Error(`Bundled ffprobe sha256 mismatch: ${actualSha}`);
    writeFileSync(file, bytes);
    if (process.platform !== 'win32') chmodSync(file, 0o755);
    return file;
  } catch {
    return undefined;
  }
}

function localFfprobeCandidates(): string[] {
  const name = executableName('ffprobe');
  const candidates = [
    join(process.cwd(), 'bin', name),
    join(process.cwd(), name),
  ];
  const executableDir = dirname(process.execPath);
  candidates.push(join(executableDir, 'bin', name), join(executableDir, name));
  if (process.argv[1]) {
    const scriptDir = dirname(resolve(process.argv[1]));
    candidates.push(join(scriptDir, 'bin', name), join(scriptDir, name));
  }
  return Array.from(new Set(candidates));
}

async function resolveFfprobe(options: { ffprobePath?: string } = {}): Promise<{
  available: boolean;
  path?: string;
  source?: 'env' | 'bundled' | 'local-bin' | 'path';
}> {
  const requested = options.ffprobePath || process.env.FFPROBE_PATH;
  if (requested && await commandExists(requested)) {
    prependProcessPath(dirname(resolve(requested)));
    return { available: true, path: requested, source: 'env' };
  }

  const bundled = ensureBundledFfprobe();
  if (bundled && await commandExists(bundled)) {
    prependProcessPath(dirname(bundled));
    return { available: true, path: bundled, source: 'bundled' };
  }

  for (const candidate of localFfprobeCandidates()) {
    if (existsSync(candidate) && await commandExists(candidate)) {
      prependProcessPath(dirname(candidate));
      return { available: true, path: candidate, source: 'local-bin' };
    }
  }

  if (await commandExists('ffprobe')) {
    return { available: true, path: 'ffprobe', source: 'path' };
  }
  return { available: false };
}

export async function getIptvPickerCoreRuntime(options: { ffprobePath?: string } = {}): Promise<{
  enabled: boolean;
  ffprobeAvailable: boolean;
  ffprobePath?: string;
  ffprobeSource?: 'env' | 'bundled' | 'local-bin' | 'path';
  nodeSupported: boolean;
}> {
  const supported = nodeSupported();
  const ffprobe = await resolveFfprobe(options);
  return {
    enabled: supported,
    ffprobeAvailable: ffprobe.available,
    ffprobePath: ffprobe.path,
    ffprobeSource: ffprobe.source,
    nodeSupported: supported,
  };
}

function isM3uContent(content: string): boolean {
  return content.includes('#EXTM3U') || content.includes('#EXTINF');
}

function splitUrlInfo(value: string): string {
  const idx = value.lastIndexOf('$');
  return stripLiveUrlSource(idx > 0 ? value.slice(0, idx) : value).trim();
}

function isPlayableUrl(value: string): boolean {
  const text = value.trim();
  if (!/^(https?|rtp|rtsp|udp):\/\//i.test(text)) return false;
  if (/^https?:\/\//i.test(text)) {
    try {
      new URL(text);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

function parseTxt(content: string): ParsedPlaylistItem[] {
  const items: ParsedPlaylistItem[] = [];
  let group = '其他';
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(',');
    if (idx <= 0) continue;
    const left = line.slice(0, idx).trim();
    const right = line.slice(idx + 1).trim();
    if (right === '#genre#') {
      group = left || '其他';
      continue;
    }
    for (const part of right.split('#')) {
      const url = splitUrlInfo(part);
      if (isPlayableUrl(url)) items.push({ name: left || '未命名', group, url });
    }
  }
  return items;
}

function parseM3uLight(content: string): ParsedPlaylistItem[] {
  const items: ParsedPlaylistItem[] = [];
  let name = '';
  let group = '其他';
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const groupMatch = line.match(/group-title="([^"]+)"/i);
      group = groupMatch ? groupMatch[1] : '其他';
      const comma = line.lastIndexOf(',');
      name = comma >= 0 ? line.slice(comma + 1).trim() : '未命名';
      continue;
    }
    if (line.startsWith('#')) continue;
    const url = splitUrlInfo(line);
    if (name && isPlayableUrl(url)) {
      items.push({ name, group, url });
      name = '';
    }
  }
  return items;
}

function toM3u(items: ParsedPlaylistItem[]): string {
  const lines = ['#EXTM3U'];
  for (const item of items) {
    const group = item.group.replace(/"/g, '&quot;').replace(/[\r\n]+/g, ' ');
    const name = item.name.replace(/[\r\n]+/g, ' ').trim() || '未命名';
    lines.push(`#EXTINF:-1 group-title="${group}",${name}`);
    lines.push(item.url);
  }
  return lines.join('\n');
}

function emitDetailLog(
  options: NormalizedIptvPickerCoreRuntimeOptions,
  type: string,
  fields: IptvPickerCoreDetailLogEvent['fields'],
): void {
  options.onDetailLog?.({ type, fields });
}

function playlistItemStats(items: ParsedPlaylistItem[]): { groups: number; channels: number; urls: number } {
  const groups = new Set<string>();
  const channels = new Set<string>();
  for (const item of items) {
    groups.add(item.group || '其他');
    channels.add(`${item.group || '其他'}\n${item.name || '未命名'}`);
  }
  return { groups: groups.size, channels: channels.size, urls: items.length };
}

function runtimeFingerprint(
  sources: IptvPickerCoreInputSource[],
  options: NormalizedIptvPickerCoreRuntimeOptions,
): string {
  const payload = {
    sources: sources.map((source) => ({
      name: source.name,
      url: source.url,
      contentHash: source.content ? createHash('sha256').update(source.content).digest('hex') : undefined,
    })),
    runtime: {
      checkMode: options.checkMode,
      preflight: options.preflight,
      preflightTimeoutMs: options.preflightTimeoutMs,
      hostTimeoutLimit: options.hostTimeoutLimit,
      preCheckCuration: options.preCheckCuration,
    },
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function emitStageLog(
  options: NormalizedIptvPickerCoreRuntimeOptions,
  type: 'start' | 'done' | 'resume' | 'resume-mismatch',
  stage: number,
  name: string,
  fields: IptvPickerCoreDetailLogEvent['fields'] = {},
): void {
  emitDetailLog(options, `stage:${type}`, {
    stage,
    name,
    ...fields,
  });
}

function createStageWorkItem(
  source: IptvPickerCoreInputSource,
  index: number,
  totalSources: number,
): StageSourceWorkItem {
  return {
    source,
    index,
    totalSources,
    startedAt: new Date().toISOString(),
    rawItems: [],
    curatedItems: [],
    preflightItems: [],
    preflightFailures: [],
    entries: [],
    lintErrors: 0,
    rawStats: { groups: 0, channels: 0, urls: 0 },
    curatedStats: { groups: 0, channels: 0, urls: 0 },
    preflightSkipped: 0,
    downloadFailed: false,
    timing: {
      downloadMs: 0,
      parseMs: 0,
      curationMs: 0,
      preflightMs: 0,
      lintMs: 0,
      checkMs: 0,
    },
  };
}

function sourceTimingFromWorkItem(item: StageSourceWorkItem): IptvPickerCoreSourceTiming {
  const entries = item.entries;
  const startedMs = Date.parse(item.startedAt);
  const finishedAt = item.finishedAt || new Date().toISOString();
  const finishedMs = Date.parse(finishedAt);
  return {
    sourceName: item.source.name,
    sourceUrl: item.source.url,
    startedAt: item.startedAt,
    finishedAt,
    durationMs: Number.isFinite(startedMs) && Number.isFinite(finishedMs)
      ? Math.max(0, finishedMs - startedMs)
      : Object.values(item.timing).reduce((sum, value) => sum + value, 0),
    downloadMs: item.timing.downloadMs,
    parseMs: item.timing.parseMs,
    curationMs: item.timing.curationMs,
    preflightMs: item.timing.preflightMs,
    lintMs: item.timing.lintMs,
    checkMs: item.timing.checkMs,
    rawGroups: item.rawStats.groups,
    rawChannels: item.rawStats.channels,
    rawUrls: item.rawStats.urls,
    matchedGroups: item.curatedStats.groups,
    matchedChannels: item.curatedStats.channels,
    matchedUrls: item.curatedStats.urls,
    templateDroppedUrls: Math.max(0, item.rawStats.urls - item.curatedStats.urls),
    preflightInputUrls: item.curatedItems.length,
    preflightPassedUrls: item.preflightItems.length,
    preflightFailedUrls: item.preflightFailures.length,
    preflightSkippedUrls: item.preflightSkipped,
    entries: entries.length,
    okEntries: entries.filter((entry) => entry.ok).length,
    failedEntries: entries.filter((entry) => !entry.ok).length,
    lintErrors: item.lintErrors,
    downloadFailed: item.downloadFailed,
  };
}

function checkpointFromWorkItems(
  items: StageSourceWorkItem[],
  options: NormalizedIptvPickerCoreRuntimeOptions,
  fingerprint: string,
  state: PreflightCheckpointFile['state'],
): PreflightCheckpointFile {
  return {
    schemaVersion: 1,
    state,
    generatedAt: new Date().toISOString(),
    fingerprint,
    runtime: {
      checkMode: options.checkMode,
      preflight: options.preflight,
      preflightTimeoutMs: options.preflightTimeoutMs,
      hostTimeoutLimit: options.hostTimeoutLimit,
      sourceParallel: options.sourceParallel,
      preflightParallel: options.preflightParallel,
      preflightHostParallel: options.preflightHostParallel,
      checkParallel: options.checkParallel,
      checkHostParallel: options.checkHostParallel,
    },
    sources: items.map((item) => ({
      index: item.index,
      totalSources: item.totalSources,
      sourceName: item.source.name,
      sourceUrl: item.source.url,
      startedAt: item.startedAt,
      finishedAt: item.finishedAt,
      downloadFailed: item.downloadFailed,
      lintErrors: item.lintErrors,
      rawStats: item.rawStats,
      curatedStats: item.curatedStats,
      preflightStats: {
        input: item.curatedItems.length,
        passed: item.preflightItems.length,
        failed: item.preflightFailures.length,
        skipped: item.preflightSkipped,
      },
      timing: item.timing,
      entriesBeforeCheck: item.entries,
      passedItems: item.preflightItems,
      failedItems: item.preflightFailures,
    })),
  };
}

async function writePreflightCheckpoint(
  filePath: string | undefined,
  items: StageSourceWorkItem[],
  options: NormalizedIptvPickerCoreRuntimeOptions,
  fingerprint: string,
  state: PreflightCheckpointFile['state'],
): Promise<void> {
  if (!filePath) return;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(checkpointFromWorkItems(items, options, fingerprint, state), null, 2), 'utf8');
}

async function readPreflightCheckpoint(filePath: string | undefined): Promise<PreflightCheckpointFile | null> {
  if (!filePath) return null;
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as PreflightCheckpointFile;
    if (parsed?.schemaVersion === 1 && Array.isArray(parsed.sources)) return parsed;
  } catch {
    return null;
  }
  return null;
}

function restoreWorkItemsFromCheckpoint(
  checkpoint: PreflightCheckpointFile,
  sources: IptvPickerCoreInputSource[],
): StageSourceWorkItem[] {
  const byUrl = new Map(sources.map((source) => [source.url, source]));
  return checkpoint.sources.map((source) => {
    const matchedSource = byUrl.get(source.sourceUrl) || {
      name: source.sourceName,
      url: source.sourceUrl,
      sourceKind: 'candidate' as const,
    };
    const item = createStageWorkItem(matchedSource, source.index, source.totalSources);
    item.startedAt = source.startedAt;
    item.finishedAt = source.finishedAt;
    item.downloadFailed = source.downloadFailed;
    item.lintErrors = source.lintErrors;
    item.rawStats = source.rawStats;
    item.curatedStats = source.curatedStats;
    item.curatedItems = [...source.passedItems, ...source.failedItems.map((failed) => ({
      name: failed.name || '未命名',
      group: failed.group?.title || '其他',
      url: failed.url,
    }))];
    item.preflightItems = source.passedItems;
    item.preflightFailures = source.failedItems;
    item.preflightSkipped = source.preflightStats.skipped;
    item.entries = source.entriesBeforeCheck;
    item.timing = source.timing;
    return item;
  });
}

function applyPreCheckCuration(
  items: ParsedPlaylistItem[],
  options: NormalizedIptvPickerCoreRuntimeOptions,
  source?: IptvPickerCoreInputSource,
): ParsedPlaylistItem[] {
  const preCheck = options.preCheckCuration;
  if (!preCheck?.enabled || preCheck.preset === 'none') return items;
  const filtered: ParsedPlaylistItem[] = [];
  const matchChannel = createChannelNameMatcher(preCheck.preset, {
    targetsFilePath: preCheck.targetsFilePath,
    aliasesFilePath: preCheck.aliasesFilePath,
  });
  for (const item of items) {
    const match = matchChannel(item.name);
    if (!match) {
      emitDetailLog(options, 'preset:drop', {
        sourceName: source?.name,
        sourceUrl: source?.url,
        preset: preCheck.preset,
        result: '未命中',
        reason: '频道未命中 preset 规则',
        originalGroup: item.group,
        originalChannel: item.name,
        url: item.url,
      });
      continue;
    }
    emitDetailLog(options, 'preset:match', {
      sourceName: source?.name,
      sourceUrl: source?.url,
      preset: preCheck.preset,
      result: '命中',
      originalGroup: item.group,
      originalChannel: item.name,
      targetGroup: match.group,
      targetChannel: match.channel,
      rule: `${match.group}/${match.channel}`,
      matchedAlias: match.matchedAlias || match.matchedCanonical || match.channel,
      url: item.url,
    });
    filtered.push({
      ...item,
      name: match.channel,
      group: match.group,
    });
  }
  emitDetailLog(options, 'preset:done', {
    sourceName: source?.name,
    sourceUrl: source?.url,
    preset: preCheck.preset,
    rawUrls: items.length,
    matchedUrls: filtered.length,
    droppedUrls: items.length - filtered.length,
  });
  return filtered;
}

function normalizeRuntimeOptions(options: IptvPickerCoreRuntimeOptions = {}): NormalizedIptvPickerCoreRuntimeOptions {
  return {
    downloadTimeoutMs: positiveIntegerOrDefault(options.downloadTimeoutMs, DEFAULT_DOWNLOAD_TIMEOUT_MS),
    checkTimeoutMs: positiveIntegerOrDefault(options.checkTimeoutMs, DEFAULT_CHECK_TIMEOUT_MS),
    checkRetry: typeof options.checkRetry === 'number' && Number.isInteger(options.checkRetry) && options.checkRetry >= 0
      ? options.checkRetry
      : DEFAULT_CHECK_RETRY,
    checkMode: options.checkMode ?? DEFAULT_CHECK_MODE,
    requireFfmpeg: options.requireFfmpeg ?? false,
    ffprobePath: options.ffprobePath,
    preflight: options.preflight ?? DEFAULT_PREFLIGHT,
    preflightTimeoutMs: positiveIntegerOrDefault(options.preflightTimeoutMs, DEFAULT_PREFLIGHT_TIMEOUT_MS),
    hostTimeoutLimit: positiveIntegerOrDefault(options.hostTimeoutLimit, DEFAULT_HOST_TIMEOUT_LIMIT),
    sourceParallel: positiveIntegerOrDefault(options.sourceParallel, DEFAULT_SOURCE_PARALLEL),
    preflightParallel: positiveIntegerOrDefault(options.preflightParallel, DEFAULT_PREFLIGHT_PARALLEL),
    preflightHostParallel: positiveIntegerOrDefault(options.preflightHostParallel, DEFAULT_PREFLIGHT_HOST_PARALLEL),
    checkParallel: positiveIntegerOrDefault(options.checkParallel, DEFAULT_CHECK_PARALLEL),
    checkHostParallel: positiveIntegerOrDefault(options.checkHostParallel, DEFAULT_CHECK_HOST_PARALLEL),
    pipelineMode: options.pipelineMode ?? DEFAULT_PIPELINE_MODE,
    preflightCheckpointPath: options.preflightCheckpointPath,
    resumePreflightPath: options.resumePreflightPath,
    preCheckCuration: options.preCheckCuration,
    onDetailLog: options.onDetailLog,
    preflightHostState: new Map(),
    ffprobeAvailable: true,
    ffprobeSource: undefined,
    noFfmpegMode: false,
  };
}

async function downloadSource(
  source: IptvPickerCoreInputSource,
  options: NormalizedIptvPickerCoreRuntimeOptions,
): Promise<DownloadSourceResult> {
  const startedMs = Date.now();
  if (source.content && source.content.trim()) {
    return {
      ok: true,
      content: source.content,
      bytes: Buffer.byteLength(source.content, 'utf8'),
      durationMs: Date.now() - startedMs,
      fromInline: true,
    };
  }
  let lastFailure: DownloadSourceResult | undefined;
  for (const requestUrl of githubRequestUrls(source.url)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.downloadTimeoutMs);
    try {
      const response = await fetch(requestUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': TVBOX_UA },
      });
      if (!response.ok) {
        lastFailure = {
          ok: false,
          content: null,
          bytes: 0,
          status: response.status,
          error: `HTTP ${response.status}`,
          durationMs: Date.now() - startedMs,
          fromInline: false,
        };
        continue;
      }
      const text = await response.text();
      const ok = !!text && text.length > 20;
      if (ok) {
        return {
          ok,
          content: text,
          bytes: Buffer.byteLength(text || '', 'utf8'),
          status: response.status,
          durationMs: Date.now() - startedMs,
          fromInline: false,
        };
      }
      lastFailure = {
        ok: false,
        content: null,
        bytes: Buffer.byteLength(text || '', 'utf8'),
        status: response.status,
        error: 'Downloaded content is empty or too short',
        durationMs: Date.now() - startedMs,
        fromInline: false,
      };
    } catch (error) {
      const isTimeout = error instanceof Error && (error.name === 'AbortError' || /abort|timeout/i.test(error.message));
      lastFailure = {
        ok: false,
        content: null,
        bytes: 0,
        error: isTimeout
          ? `Download timed out after ${options.downloadTimeoutMs} ms`
          : error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedMs,
        fromInline: false,
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return lastFailure || {
    ok: false,
    content: null,
    bytes: 0,
    error: 'Download failed',
    durationMs: Date.now() - startedMs,
    fromInline: false,
  };
}

async function lintM3u(content: string): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), 'tvbox-m3u-lint-'));
  try {
    const playlist = join(dir, 'playlist.m3u');
    await writeFile(playlist, content, 'utf8');
    const linter = nodeRequire('m3u-linter') as { lint: (config: unknown, files?: string[]) => Promise<number> };
    return await withSilencedLintOutput(() => linter.lint({ files: [playlist], rules: LINTER_RULES }, [playlist]));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function withSilencedLintOutput<T>(run: () => Promise<T>): Promise<T> {
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.warn = noop;
  console.error = noop;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    return await run();
  } finally {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    process.stdout.write = originalStdoutWrite as typeof process.stdout.write;
    process.stderr.write = originalStderrWrite as typeof process.stderr.write;
  }
}

interface CheckedPlaylistItem {
  url: string;
  name?: string;
  group?: { title?: string };
  status: {
    ok: boolean;
    code: string;
    message?: string;
    metadata?: { streams?: unknown[]; format?: Record<string, unknown> };
  };
}

function preflightHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return null;
  }
}

function preflightFailureItem(item: ParsedPlaylistItem, code: string, message: string): CheckedPlaylistItem {
  return {
    url: item.url,
    name: item.name,
    group: { title: item.group },
    status: { ok: false, code, message },
  };
}

async function preflightItem(
  item: ParsedPlaylistItem,
  options: NormalizedIptvPickerCoreRuntimeOptions,
): Promise<{ item?: ParsedPlaylistItem; failure?: CheckedPlaylistItem; durationMs: number }> {
  const startedMs = Date.now();
  if (!options.preflight) return { item, durationMs: Date.now() - startedMs };
  const host = preflightHost(item.url);
  if (!host) return { item, durationMs: Date.now() - startedMs };

  const state = options.preflightHostState.get(host) || { timeoutCount: 0, blocked: false };
  if (state.blocked || state.timeoutCount >= options.hostTimeoutLimit) {
    state.blocked = true;
    options.preflightHostState.set(host, state);
    const durationMs = Date.now() - startedMs;
    emitDetailLog(options, 'source:preflight:item', {
      result: 'skipped',
      group: item.group,
      channel: item.name,
      host,
      errorCode: 'HOST_PREFLIGHT_SKIPPED',
      message: `Skipped because ${host} reached ${options.hostTimeoutLimit} consecutive header timeouts`,
      durationMs,
      url: item.url,
    });
    return {
      failure: preflightFailureItem(
        item,
        'HOST_PREFLIGHT_SKIPPED',
        `Skipped because ${host} reached ${options.hostTimeoutLimit} consecutive header timeouts`,
      ),
      durationMs,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.preflightTimeoutMs);
  try {
    const response = await fetch(item.url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': TVBOX_UA },
      redirect: 'follow',
    });
    state.timeoutCount = 0;
    options.preflightHostState.set(host, state);
    if (response.status === 404 || response.status === 410) {
      const durationMs = Date.now() - startedMs;
      emitDetailLog(options, 'source:preflight:item', {
        result: 'failed',
        group: item.group,
        channel: item.name,
        host,
        status: response.status,
        errorCode: 'PREFLIGHT_HTTP_NOT_FOUND',
        message: `HTTP ${response.status}`,
        durationMs,
        url: item.url,
      });
      return {
        failure: preflightFailureItem(item, 'PREFLIGHT_HTTP_NOT_FOUND', `HTTP ${response.status}`),
        durationMs,
      };
    }
    const durationMs = Date.now() - startedMs;
    emitDetailLog(options, 'source:preflight:item', {
      result: 'ok',
      group: item.group,
      channel: item.name,
      host,
      status: response.status,
      durationMs,
      url: item.url,
    });
    return { item, durationMs };
  } catch (error) {
    const isTimeout = error instanceof Error && (error.name === 'AbortError' || /abort|timeout/i.test(error.message));
    if (isTimeout) {
      state.timeoutCount++;
      if (state.timeoutCount >= options.hostTimeoutLimit) state.blocked = true;
      options.preflightHostState.set(host, state);
      const durationMs = Date.now() - startedMs;
      emitDetailLog(options, 'source:preflight:item', {
        result: 'failed',
        group: item.group,
        channel: item.name,
        host,
        errorCode: 'PREFLIGHT_TIMEOUT',
        message: `Header preflight timed out after ${options.preflightTimeoutMs} ms`,
        durationMs,
        url: item.url,
      });
      return {
        failure: preflightFailureItem(
          item,
          'PREFLIGHT_TIMEOUT',
          `Header preflight timed out after ${options.preflightTimeoutMs} ms`,
        ),
        durationMs,
      };
    }
    state.timeoutCount = 0;
    options.preflightHostState.set(host, state);
    const durationMs = Date.now() - startedMs;
    emitDetailLog(options, 'source:preflight:item', {
      result: 'ok',
      group: item.group,
      channel: item.name,
      host,
      message: error instanceof Error ? error.message : String(error),
      durationMs,
      url: item.url,
    });
    return { item, durationMs };
  } finally {
    clearTimeout(timer);
  }
}

async function preflightItems(
  items: ParsedPlaylistItem[],
  options: NormalizedIptvPickerCoreRuntimeOptions,
): Promise<{ items: ParsedPlaylistItem[]; failures: CheckedPlaylistItem[]; durationMs: number; skipped: number }> {
  if (!options.preflight) return { items, failures: [], durationMs: 0, skipped: 0 };
  const startedMs = Date.now();
  const results = await mapLimitByKey(
    items,
    options.preflightParallel,
    options.preflightHostParallel,
    (item) => preflightHost(item.url),
    (item) => preflightItem(item, options),
  );
  const failures = results.flatMap((result) => result.failure ? [result.failure] : []);
  return {
    items: results.flatMap((result) => result.item ? [result.item] : []),
    failures,
    durationMs: Date.now() - startedMs,
    skipped: failures.filter((item) => item.status?.code === 'HOST_PREFLIGHT_SKIPPED').length,
  };
}

async function checkPlaylist(
  content: string,
  options: NormalizedIptvPickerCoreRuntimeOptions,
  parallel = options.checkParallel,
): Promise<CheckedPlaylistItem[]> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
  const mod = await dynamicImport('iptv-checker');
  const checker = new mod.IPTVChecker({
    timeout: options.checkTimeoutMs,
    parallel,
    retry: options.checkRetry,
    userAgent: TVBOX_UA,
  });
  const result = await checker.checkPlaylist(content);
  return Array.isArray(result?.items) ? result.items : [];
}

function ffprobeArgs(url: string, options: NormalizedIptvPickerCoreRuntimeOptions): string[] {
  return [
    '-v', 'error',
    '-hide_banner',
    '-of', 'json',
    '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,bit_rate:format=format_name,bit_rate',
    '-timeout', String(options.checkTimeoutMs * 1000),
    '-user_agent', TVBOX_UA,
    url,
  ];
}

function fastFailureStatus(error: unknown): CheckedPlaylistItem['status'] {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const code = lower.includes('timeout') || lower.includes('timed out')
    ? 'CHECK_TIMEOUT'
    : 'CHECK_FAILED';
  return { ok: false, code, message };
}

async function checkFastItem(
  item: ParsedPlaylistItem,
  options: NormalizedIptvPickerCoreRuntimeOptions,
): Promise<CheckedPlaylistItem> {
  for (let attempt = 0; attempt <= options.checkRetry; attempt++) {
    try {
      const { stdout } = await execFileAsync(options.ffprobePath || 'ffprobe', ffprobeArgs(item.url, options), {
        timeout: options.checkTimeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      const metadata = JSON.parse(String(stdout || '{}')) as { streams?: unknown[]; format?: Record<string, unknown> };
      if (!Array.isArray(metadata.streams) || metadata.streams.length === 0) {
        return {
          url: item.url,
          name: item.name,
          group: { title: item.group },
          status: {
            ok: false,
            code: 'FFMPEG_STREAMS_NOT_FOUND',
            message: 'No media streams found',
          },
        };
      }
      return {
        url: item.url,
        name: item.name,
        group: { title: item.group },
        status: { ok: true, code: 'OK', metadata },
      };
    } catch (error) {
      if (attempt >= options.checkRetry) {
        return {
          url: item.url,
          name: item.name,
          group: { title: item.group },
          status: fastFailureStatus(error),
        };
      }
    }
  }

  return {
    url: item.url,
    name: item.name,
    group: { title: item.group },
    status: { ok: false, code: 'CHECK_FAILED', message: 'Fast check failed' },
  };
}

async function checkFullItem(
  item: ParsedPlaylistItem,
  options: NormalizedIptvPickerCoreRuntimeOptions,
): Promise<CheckedPlaylistItem> {
  try {
    const checkedItems = await checkPlaylist(toM3u([item]), options, 1);
    const checked = checkedItems.find((checkedItem) => splitUrlInfo(checkedItem.url) === splitUrlInfo(item.url))
      || checkedItems[0];
    if (checked) return checked;
    return {
      url: item.url,
      name: item.name,
      group: { title: item.group },
      status: {
        ok: false,
        code: 'CHECK_NO_RESULT',
        message: 'No check result returned',
      },
    };
  } catch (error) {
    return {
      url: item.url,
      name: item.name,
      group: { title: item.group },
      status: {
        ok: false,
        code: 'CHECK_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await run(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function mapLimitByKey<T, R>(
  items: T[],
  limit: number,
  keyLimit: number,
  keyOf: (item: T, index: number) => string | null | undefined,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const pending = new Set(items.map((_, index) => index));
  const activeByKey = new Map<string, number>();
  let active = 0;
  let completed = 0;
  let rejected = false;

  return new Promise<R[]>((resolve, reject) => {
    const schedule = () => {
      if (rejected) return;
      if (completed >= items.length) {
        resolve(results);
        return;
      }

      let started = false;
      while (active < limit && pending.size > 0) {
        let selectedIndex: number | undefined;
        let selectedKey: string | undefined;

        for (const index of pending) {
          const key = keyOf(items[index], index) || `__item_${index}`;
          if ((activeByKey.get(key) || 0) < keyLimit) {
            selectedIndex = index;
            selectedKey = key;
            break;
          }
        }

        if (selectedIndex == null || selectedKey == null) break;

        pending.delete(selectedIndex);
        active++;
        activeByKey.set(selectedKey, (activeByKey.get(selectedKey) || 0) + 1);
        started = true;

        Promise.resolve(run(items[selectedIndex], selectedIndex))
          .then((result) => {
            results[selectedIndex] = result;
          })
          .catch((error) => {
            rejected = true;
            reject(error);
          })
          .finally(() => {
            active--;
            const nextCount = (activeByKey.get(selectedKey) || 1) - 1;
            if (nextCount <= 0) activeByKey.delete(selectedKey);
            else activeByKey.set(selectedKey, nextCount);
            completed++;
            schedule();
          });
      }

      if (!started && active === 0 && pending.size > 0) {
        rejected = true;
        reject(new Error('Unable to schedule host-limited tasks.'));
      }
    };

    schedule();
  });
}

async function checkPlaylistFast(
  items: ParsedPlaylistItem[],
  options: NormalizedIptvPickerCoreRuntimeOptions,
  source: IptvPickerCoreInputSource,
): Promise<CheckedPlaylistItem[]> {
  return mapLimitByKey(items, options.checkParallel, options.checkHostParallel, (item) => preflightHost(item.url), async (item) => {
    emitUrlCheckStart(options, source, item);
    const startedMs = Date.now();
    const checked = await checkFastItem(item, options);
    emitUrlCheckResult(options, normalizeCheckedItem(checked, source, 'ffprobe-fast'), Date.now() - startedMs);
    return checked;
  });
}

async function checkPlaylistFull(
  items: ParsedPlaylistItem[],
  options: NormalizedIptvPickerCoreRuntimeOptions,
  source: IptvPickerCoreInputSource,
): Promise<CheckedPlaylistItem[]> {
  return mapLimitByKey(items, options.checkParallel, options.checkHostParallel, (item) => preflightHost(item.url), async (item) => {
    emitUrlCheckStart(options, source, item);
    const startedMs = Date.now();
    const checked = await checkFullItem(item, options);
    emitUrlCheckResult(options, normalizeCheckedItem(checked, source, 'iptv-checker'), Date.now() - startedMs);
    return checked;
  });
}

function firstVideoStream(streams: unknown[] | undefined): Record<string, unknown> | null {
  if (!Array.isArray(streams)) return null;
  const video = streams.find((stream) => {
    return !!stream && typeof stream === 'object' && (stream as { codec_type?: unknown }).codec_type === 'video';
  });
  return video && typeof video === 'object' ? video as Record<string, unknown> : null;
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return isFinite(n) ? n : null;
}

function parseFps(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const [a, b] = value.split('/').map(Number);
  if (!isFinite(a) || !isFinite(b) || b === 0) return null;
  return Number((a / b).toFixed(2));
}

function normalizeCheckedItem(
  item: CheckedPlaylistItem,
  source: IptvPickerCoreInputSource,
  engine: IptvPickerCoreChannelEntry['engine'] = 'iptv-checker',
): IptvPickerCoreChannelEntry {
  const status = item.status || { ok: false, code: 'NO_STATUS', message: 'No status returned' };
  const stream = firstVideoStream(status.metadata?.streams);
  const width = numberOrNull(stream?.width);
  const height = numberOrNull(stream?.height);
  const format = status.metadata?.format || {};
  const bareUrl = splitUrlInfo(item.url);

  return {
    bareUrl,
    ok: status.ok === true,
    engine,
    checkedAt: new Date().toISOString(),
    errorCode: status.ok ? undefined : status.code,
    errorMessage: status.ok ? undefined : status.message || status.code,
    probeMode: engine === 'no-ffmpeg' ? 'no-ffmpeg' : 'ffmpeg',
    resolution: width && height ? `${width}x${height}` : null,
    codec: typeof stream?.codec_name === 'string' ? stream.codec_name : null,
    bitrate: numberOrNull(stream?.bit_rate) ?? numberOrNull(format.bit_rate),
    fps: parseFps(stream?.avg_frame_rate) ?? parseFps(stream?.r_frame_rate),
    formatName: typeof format.format_name === 'string' ? format.format_name : null,
    sourceUrl: source.url,
    sourceName: source.name,
    channel: item.name || undefined,
    group: item.group?.title || undefined,
  };
}

function buildNoFfmpegEntry(
  item: ParsedPlaylistItem,
  source: IptvPickerCoreInputSource,
): IptvPickerCoreChannelEntry {
  return {
    bareUrl: splitUrlInfo(item.url),
    ok: true,
    engine: 'no-ffmpeg',
    checkedAt: new Date().toISOString(),
    probeMode: 'no-ffmpeg',
    probeWarning: 'no-ffmpeg: ffprobe not found, playback quality was not verified.',
    resolution: null,
    codec: null,
    bitrate: null,
    fps: null,
    formatName: null,
    sourceUrl: source.url,
    sourceName: source.name,
    channel: item.name || undefined,
    group: item.group || undefined,
  };
}

function buildNoFfmpegEntries(
  items: ParsedPlaylistItem[],
  source: IptvPickerCoreInputSource,
): IptvPickerCoreChannelEntry[] {
  return items
    .filter((item) => typeof item.url === 'string' && item.url.trim())
    .map((item) => buildNoFfmpegEntry(item, source));
}

function emitUrlCheckStart(
  options: NormalizedIptvPickerCoreRuntimeOptions,
  source: IptvPickerCoreInputSource,
  item: ParsedPlaylistItem,
): void {
  emitDetailLog(options, 'url:check:start', {
    sourceName: source.name,
    sourceUrl: source.url,
    group: item.group,
    channel: item.name,
    url: item.url,
  });
}

function emitUrlCheckResult(
  options: NormalizedIptvPickerCoreRuntimeOptions,
  entry: IptvPickerCoreChannelEntry,
  durationMs: number | string,
): void {
  emitDetailLog(options, entry.ok ? 'url:check:ok' : 'url:check:failed', {
    sourceName: entry.sourceName,
    sourceUrl: entry.sourceUrl,
    group: entry.group,
    channel: entry.channel,
    resolution: entry.resolution,
    bitrate: entry.bitrate,
    fps: entry.fps,
    codec: entry.codec,
    format: entry.formatName,
    probeMode: entry.probeMode,
    warning: entry.probeWarning,
    errorCode: entry.errorCode,
    message: entry.errorMessage,
    durationMs,
    url: entry.bareUrl,
  });
}

function emitUrlPreflightFailureResult(
  options: NormalizedIptvPickerCoreRuntimeOptions,
  entry: IptvPickerCoreChannelEntry,
  durationMs: number | string,
): void {
  emitDetailLog(options, 'url:preflight:failed', {
    sourceName: entry.sourceName,
    sourceUrl: entry.sourceUrl,
    group: entry.group,
    channel: entry.channel,
    resolution: entry.resolution,
    bitrate: entry.bitrate,
    fps: entry.fps,
    codec: entry.codec,
    format: entry.formatName,
    errorCode: entry.errorCode,
    message: entry.errorMessage,
    durationMs,
    url: entry.bareUrl,
  });
}

function isPreflightErrorCode(code: string | undefined): boolean {
  return !!code && (code.startsWith('PREFLIGHT_') || code === 'HOST_PREFLIGHT_SKIPPED');
}

function isPlaybackCheckEntry(entry: IptvPickerCoreChannelEntry): boolean {
  if (entry.ok) return true;
  if (isPreflightErrorCode(entry.errorCode)) return false;
  if (entry.errorCode === 'SOURCE_DOWNLOAD_FAILED' || entry.errorCode === 'LINT_FAILED') return false;
  return true;
}

export function buildIptvPickerCoreReportFromEntries(entries: IptvPickerCoreChannelEntry[]): IptvPickerCoreReport {
  const bySource = new Map<string, IptvPickerCoreChannelEntry[]>();
  const noFfmpegEntries = entries.filter((entry) => entry.probeMode === 'no-ffmpeg' || entry.engine === 'no-ffmpeg').length;
  for (const entry of entries) {
    const key = entry.sourceUrl || entry.sourceName || 'unknown';
    const list = bySource.get(key) || [];
    list.push(entry);
    bySource.set(key, list);
  }

  const sources: IptvPickerCoreSourceSummary[] = Array.from(bySource, ([sourceUrl, list]) => {
    const sourceName = list.find((entry) => entry.sourceName)?.sourceName || sourceUrl;
    return {
      sourceUrl,
      sourceName,
      totalUrls: list.length,
      okUrls: list.filter((entry) => entry.ok).length,
      failedUrls: list.filter((entry) => !entry.ok).length,
      formatErrors: list.filter((entry) => entry.errorCode === 'LINT_FAILED').length,
      templateMatchedChannels: 0,
      checkedAt: list.reduce((latest, entry) => entry.checkedAt > latest ? entry.checkedAt : latest, ''),
    };
  }).sort((a, b) => b.okUrls - a.okUrls || b.totalUrls - a.totalUrls);

  return {
    generatedAt: new Date().toISOString(),
    probeMode: noFfmpegEntries > 0 ? 'no-ffmpeg' : 'ffmpeg',
    noFfmpegEntries,
    totalSources: sources.length,
    totalUrls: entries.length,
    okUrls: entries.filter((entry) => entry.ok).length,
    failedUrls: entries.filter((entry) => !entry.ok).length,
    formatErrors: entries.filter((entry) => entry.errorCode === 'LINT_FAILED').length,
    sources,
  };
}

type IptvPickerCoreSourceTiming = NonNullable<IptvPickerCoreFileResult['timing']>['sources'][number];

async function checkSourceToEntries(
  source: IptvPickerCoreInputSource,
  options: NormalizedIptvPickerCoreRuntimeOptions,
  sourceIndex: number,
  totalSources: number,
): Promise<{
  entries: IptvPickerCoreChannelEntry[];
  timing: IptvPickerCoreSourceTiming;
}> {
  const sourceStartMs = Date.now();
  const sourceStartedAt = new Date(sourceStartMs).toISOString();
  let downloadMs = 0;
  let parseMs = 0;
  let lintMs = 0;
  let checkMs = 0;
  let curationMs = 0;
  let lintErrors = 0;
  let parsedGroups = 0;
  let parsedChannels = 0;
  let parsedUrls = 0;
  let preflightMs = 0;
  let preflightSkipped = 0;

  emitDetailLog(options, 'source:start', {
    index: `${sourceIndex}/${totalSources}`,
    sourceName: source.name,
    sourceUrl: source.url,
  });

  const downloadStart = Date.now();
  const download = await downloadSource(source, options);
  downloadMs = Date.now() - downloadStart;
  if (!download.ok || !download.content) {
    emitDetailLog(options, 'source:download:failed', {
      index: `${sourceIndex}/${totalSources}`,
      sourceName: source.name,
      sourceUrl: source.url,
      status: download.status,
      error: download.error || 'Source download failed',
      timeoutMs: options.downloadTimeoutMs,
      durationMs: download.durationMs,
    });
    const entries: IptvPickerCoreChannelEntry[] = [{
      bareUrl: source.url,
      ok: false,
      engine: options.checkMode === 'fast' ? 'ffprobe-fast' : 'iptv-checker',
      checkedAt: new Date().toISOString(),
      errorCode: 'SOURCE_DOWNLOAD_FAILED',
      errorMessage: download.error || 'Source download failed',
      sourceUrl: source.url,
      sourceName: source.name,
    }];
    const finishedAt = new Date().toISOString();
    emitDetailLog(options, 'source:done', {
      index: `${sourceIndex}/${totalSources}`,
      sourceName: source.name,
      sourceUrl: source.url,
      status: 'failed',
      reason: download.error || 'Source download failed',
      groups: 0,
      channels: 0,
      urls: 0,
      ok: 0,
      failed: entries.length,
      downloadMs,
      parseMs,
      preflightMs,
      checkMs,
      durationMs: Date.now() - sourceStartMs,
    });
    return {
      entries,
      timing: {
        sourceName: source.name,
        sourceUrl: source.url,
        startedAt: sourceStartedAt,
        finishedAt,
        durationMs: Date.now() - sourceStartMs,
        downloadMs,
        parseMs,
        curationMs,
        preflightMs,
        lintMs,
        checkMs,
        rawGroups: 0,
        rawChannels: 0,
        rawUrls: 0,
        matchedGroups: 0,
        matchedChannels: 0,
        matchedUrls: 0,
        templateDroppedUrls: 0,
        preflightInputUrls: 0,
        preflightPassedUrls: 0,
        preflightFailedUrls: 0,
        preflightSkippedUrls: 0,
        entries: entries.length,
        okEntries: 0,
        failedEntries: entries.length,
        lintErrors: 0,
        downloadFailed: true,
      },
    };
  }

  emitDetailLog(options, 'source:download:ok', {
    index: `${sourceIndex}/${totalSources}`,
    sourceName: source.name,
    sourceUrl: source.url,
    sizeKb: Number((download.bytes / 1024).toFixed(2)),
    fromInline: download.fromInline,
    status: download.status,
    durationMs: download.durationMs,
  });

  const parseStart = Date.now();
  const content = download.content;
  const contentIsM3u = isM3uContent(content);
  const parsedItemsRaw = contentIsM3u ? parseM3uLight(content) : parseTxt(content);
  const rawStats = playlistItemStats(parsedItemsRaw);
  parseMs = Date.now() - parseStart;
  const curationStart = Date.now();
  const parsedItemsBeforePreflight = applyPreCheckCuration(parsedItemsRaw, options, source);
  curationMs = Date.now() - curationStart;
  const filteredStats = playlistItemStats(parsedItemsBeforePreflight);
  parsedGroups = filteredStats.groups;
  parsedChannels = filteredStats.channels;
  parsedUrls = filteredStats.urls;
  emitDetailLog(options, 'source:parse:ok', {
    index: `${sourceIndex}/${totalSources}`,
    sourceName: source.name,
    sourceUrl: source.url,
    format: contentIsM3u ? 'm3u' : 'txt',
    isM3u: contentIsM3u,
    rawGroups: rawStats.groups,
    rawChannels: rawStats.channels,
    rawUrls: rawStats.urls,
    groups: filteredStats.groups,
    channels: filteredStats.channels,
    urls: filteredStats.urls,
    preFilter: !!options.preCheckCuration?.enabled,
    kept: parsedItemsBeforePreflight.length,
    durationMs: parseMs,
  });
  emitDetailLog(options, 'preset:timing', {
    index: `${sourceIndex}/${totalSources}`,
    sourceName: source.name,
    sourceUrl: source.url,
    enabled: !!options.preCheckCuration?.enabled,
    preset: options.preCheckCuration?.preset || 'none',
    durationMs: curationMs,
  });
  emitDetailLog(options, 'source:preflight:start', {
    index: `${sourceIndex}/${totalSources}`,
    sourceName: source.name,
    sourceUrl: source.url,
    enabled: options.preflight,
    urls: parsedItemsBeforePreflight.length,
    timeoutMs: options.preflightTimeoutMs,
    hostTimeoutLimit: options.hostTimeoutLimit,
    parallel: options.preflightParallel,
    hostParallel: options.preflightHostParallel,
  });
  const preflight = await preflightItems(parsedItemsBeforePreflight, options);
  preflightMs = preflight.durationMs;
  preflightSkipped = preflight.skipped;
  const parsedItems = preflight.items;
  const playlist = toM3u(parsedItems);
  emitDetailLog(options, 'source:preflight:done', {
    index: `${sourceIndex}/${totalSources}`,
    sourceName: source.name,
    sourceUrl: source.url,
    enabled: options.preflight,
    input: parsedItemsBeforePreflight.length,
    passed: parsedItems.length,
    failed: preflight.failures.length,
    skipped: preflightSkipped,
    durationMs: preflightMs,
  });
  const preflightEngine: IptvPickerCoreChannelEntry['engine'] = options.checkMode === 'fast' ? 'ffprobe-fast' : 'iptv-checker';
  const entries: IptvPickerCoreChannelEntry[] = preflight.failures.map((item) => normalizeCheckedItem(item, source, preflightEngine));
  for (const entry of entries) {
    emitUrlPreflightFailureResult(options, entry, '-');
  }

  if (contentIsM3u && options.checkMode !== 'fast') {
    const lintStart = Date.now();
    const lintContent = parsedItemsRaw.length === 0 && /#EXTINF/i.test(content) ? content : playlist;
    lintErrors = await lintM3u(lintContent);
    lintMs = Date.now() - lintStart;
    if (lintErrors > 0) {
      entries.push({
        bareUrl: source.url,
        ok: false,
        engine: 'iptv-checker',
        checkedAt: new Date().toISOString(),
        errorCode: 'LINT_FAILED',
        errorMessage: `m3u-linter reported ${lintErrors} errors`,
        sourceUrl: source.url,
        sourceName: source.name,
      });
    }
  }

  const checkStart = Date.now();
  try {
    if (parsedItems.length > 0) {
      if (options.noFfmpegMode) {
        const checkedEntries = buildNoFfmpegEntries(parsedItems, source);
        for (const entry of checkedEntries) emitUrlCheckResult(options, entry, 'skipped');
        entries.push(...checkedEntries);
      } else {
        const engine: IptvPickerCoreChannelEntry['engine'] = options.checkMode === 'fast' ? 'ffprobe-fast' : 'iptv-checker';
        const checkedItems = options.checkMode === 'fast'
          ? await checkPlaylistFast(parsedItems, options, source)
          : await checkPlaylistFull(parsedItems, options, source);
        entries.push(...checkedItems
          .filter((item) => typeof item.url === 'string' && item.url.trim())
          .map((item) => normalizeCheckedItem(item, source, engine)));
      }
    }
  } catch (error) {
    entries.push({
      bareUrl: source.url,
      ok: false,
      engine: options.checkMode === 'fast' ? 'ffprobe-fast' : 'iptv-checker',
      checkedAt: new Date().toISOString(),
      errorCode: 'CHECK_FAILED',
      errorMessage: error instanceof Error ? error.message : String(error),
      sourceUrl: source.url,
      sourceName: source.name,
    });
  }
  checkMs = Date.now() - checkStart;

  const finishedAt = new Date().toISOString();
  emitDetailLog(options, 'source:done', {
    index: `${sourceIndex}/${totalSources}`,
    sourceName: source.name,
    sourceUrl: source.url,
    status: entries.some((entry) => entry.ok) ? 'ok' : 'failed',
    groups: parsedGroups,
    channels: parsedChannels,
    urls: parsedUrls,
    ok: entries.filter((entry) => entry.ok).length,
    failed: entries.filter((entry) => !entry.ok).length,
    downloadMs,
    parseMs,
    curationMs,
    preflightMs,
    checkMs,
    durationMs: Date.now() - sourceStartMs,
  });
  return {
    entries,
    timing: {
      sourceName: source.name,
      sourceUrl: source.url,
      startedAt: sourceStartedAt,
      finishedAt,
      durationMs: Date.now() - sourceStartMs,
      downloadMs,
      parseMs,
      curationMs,
      preflightMs,
      lintMs,
      checkMs,
      rawGroups: rawStats.groups,
      rawChannels: rawStats.channels,
      rawUrls: rawStats.urls,
      matchedGroups: filteredStats.groups,
      matchedChannels: filteredStats.channels,
      matchedUrls: filteredStats.urls,
      templateDroppedUrls: Math.max(0, rawStats.urls - filteredStats.urls),
      preflightInputUrls: parsedItemsBeforePreflight.length,
      preflightPassedUrls: parsedItems.length,
      preflightFailedUrls: preflight.failures.length,
      preflightSkippedUrls: preflightSkipped,
      entries: entries.length,
      okEntries: entries.filter((entry) => entry.ok).length,
      failedEntries: entries.filter((entry) => !entry.ok).length,
      lintErrors,
      downloadFailed: false,
    },
  };
}

function buildDownloadFailureEntry(
  source: IptvPickerCoreInputSource,
  options: NormalizedIptvPickerCoreRuntimeOptions,
  message: string,
): IptvPickerCoreChannelEntry {
  return {
    bareUrl: source.url,
    ok: false,
    engine: options.checkMode === 'fast' ? 'ffprobe-fast' : 'iptv-checker',
    checkedAt: new Date().toISOString(),
    errorCode: 'SOURCE_DOWNLOAD_FAILED',
    errorMessage: message,
    sourceUrl: source.url,
    sourceName: source.name,
  };
}

function buildLintFailureEntry(
  source: IptvPickerCoreInputSource,
  options: NormalizedIptvPickerCoreRuntimeOptions,
  lintErrors: number,
): IptvPickerCoreChannelEntry {
  return {
    bareUrl: source.url,
    ok: false,
    engine: options.checkMode === 'fast' ? 'ffprobe-fast' : 'iptv-checker',
    checkedAt: new Date().toISOString(),
    errorCode: 'LINT_FAILED',
    errorMessage: `m3u-linter reported ${lintErrors} errors`,
    sourceUrl: source.url,
    sourceName: source.name,
  };
}

async function runStageDownloadAndLint(
  items: StageSourceWorkItem[],
  options: NormalizedIptvPickerCoreRuntimeOptions,
): Promise<void> {
  await mapLimit(items, options.sourceParallel, async (item) => {
    emitDetailLog(options, 'source:start', {
      index: `${item.index}/${item.totalSources}`,
      sourceName: item.source.name,
      sourceUrl: item.source.url,
    });
    const downloadStart = Date.now();
    const download = await downloadSource(item.source, options);
    item.timing.downloadMs = Date.now() - downloadStart;
    item.download = download;
    if (!download.ok || !download.content) {
      item.downloadFailed = true;
      item.entries.push(buildDownloadFailureEntry(item.source, options, download.error || 'Source download failed'));
      item.finishedAt = new Date().toISOString();
      emitDetailLog(options, 'source:download:failed', {
        index: `${item.index}/${item.totalSources}`,
        sourceName: item.source.name,
        sourceUrl: item.source.url,
        status: download.status,
        error: download.error || 'Source download failed',
        timeoutMs: options.downloadTimeoutMs,
        durationMs: download.durationMs,
      });
      emitDetailLog(options, 'source:done', {
        index: `${item.index}/${item.totalSources}`,
        sourceName: item.source.name,
        sourceUrl: item.source.url,
        status: 'failed',
        reason: download.error || 'Source download failed',
        groups: 0,
        channels: 0,
        urls: 0,
        ok: 0,
        failed: item.entries.length,
        downloadMs: item.timing.downloadMs,
        parseMs: item.timing.parseMs,
        curationMs: item.timing.curationMs,
        preflightMs: item.timing.preflightMs,
        lintMs: item.timing.lintMs,
        checkMs: item.timing.checkMs,
        durationMs: Date.now() - Date.parse(item.startedAt),
      });
      return;
    }

    item.content = download.content;
    item.contentIsM3u = isM3uContent(download.content);
    emitDetailLog(options, 'source:download:ok', {
      index: `${item.index}/${item.totalSources}`,
      sourceName: item.source.name,
      sourceUrl: item.source.url,
      sizeKb: Number((download.bytes / 1024).toFixed(2)),
      fromInline: download.fromInline,
      status: download.status,
      durationMs: download.durationMs,
    });

    if (item.contentIsM3u && options.checkMode !== 'fast') {
      const lintStart = Date.now();
      item.lintErrors = await lintM3u(download.content);
      item.timing.lintMs = Date.now() - lintStart;
      emitDetailLog(options, 'source:lint:done', {
        index: `${item.index}/${item.totalSources}`,
        sourceName: item.source.name,
        sourceUrl: item.source.url,
        lintErrors: item.lintErrors,
        durationMs: item.timing.lintMs,
      });
      if (item.lintErrors > 0) {
        item.entries.push(buildLintFailureEntry(item.source, options, item.lintErrors));
      }
    }
  });
}

async function runStageParseAndCuration(
  items: StageSourceWorkItem[],
  options: NormalizedIptvPickerCoreRuntimeOptions,
): Promise<void> {
  await mapLimit(items.filter((item) => !item.downloadFailed && item.content), options.sourceParallel, async (item) => {
    const parseStart = Date.now();
    const content = item.content || '';
    item.rawItems = item.contentIsM3u ? parseM3uLight(content) : parseTxt(content);
    item.rawStats = playlistItemStats(item.rawItems);
    item.timing.parseMs = Date.now() - parseStart;

    const curationStart = Date.now();
    item.curatedItems = applyPreCheckCuration(item.rawItems, options, item.source);
    item.timing.curationMs = Date.now() - curationStart;
    item.curatedStats = playlistItemStats(item.curatedItems);

    emitDetailLog(options, 'source:parse:ok', {
      index: `${item.index}/${item.totalSources}`,
      sourceName: item.source.name,
      sourceUrl: item.source.url,
      format: item.contentIsM3u ? 'm3u' : 'txt',
      isM3u: !!item.contentIsM3u,
      rawGroups: item.rawStats.groups,
      rawChannels: item.rawStats.channels,
      rawUrls: item.rawStats.urls,
      groups: item.curatedStats.groups,
      channels: item.curatedStats.channels,
      urls: item.curatedStats.urls,
      preFilter: !!options.preCheckCuration?.enabled,
      kept: item.curatedItems.length,
      durationMs: item.timing.parseMs,
    });
    emitDetailLog(options, 'preset:timing', {
      index: `${item.index}/${item.totalSources}`,
      sourceName: item.source.name,
      sourceUrl: item.source.url,
      enabled: !!options.preCheckCuration?.enabled,
      preset: options.preCheckCuration?.preset || 'none',
      durationMs: item.timing.curationMs,
    });
  });
}

async function runStagePreflight(
  items: StageSourceWorkItem[],
  options: NormalizedIptvPickerCoreRuntimeOptions,
  fingerprint: string,
): Promise<void> {
  await mapLimit(items.filter((item) => !item.downloadFailed), options.sourceParallel, async (item) => {
    emitDetailLog(options, 'source:preflight:start', {
      index: `${item.index}/${item.totalSources}`,
      sourceName: item.source.name,
      sourceUrl: item.source.url,
      enabled: options.preflight,
      urls: item.curatedItems.length,
      timeoutMs: options.preflightTimeoutMs,
      hostTimeoutLimit: options.hostTimeoutLimit,
      parallel: options.preflightParallel,
      hostParallel: options.preflightHostParallel,
    });
    const preflight = await preflightItems(item.curatedItems, options);
    item.timing.preflightMs = preflight.durationMs;
    item.preflightItems = preflight.items;
    item.preflightFailures = preflight.failures;
    item.preflightSkipped = preflight.skipped;
    const preflightEngine: IptvPickerCoreChannelEntry['engine'] = options.checkMode === 'fast' ? 'ffprobe-fast' : 'iptv-checker';
    const preflightEntries = preflight.failures.map((failed) => normalizeCheckedItem(failed, item.source, preflightEngine));
    item.entries.push(...preflightEntries);
    for (const entry of preflightEntries) emitUrlPreflightFailureResult(options, entry, '-');
    emitDetailLog(options, 'source:preflight:done', {
      index: `${item.index}/${item.totalSources}`,
      sourceName: item.source.name,
      sourceUrl: item.source.url,
      enabled: options.preflight,
      input: item.curatedItems.length,
      passed: item.preflightItems.length,
      failed: item.preflightFailures.length,
      skipped: item.preflightSkipped,
      durationMs: item.timing.preflightMs,
    });
    await writePreflightCheckpoint(
      options.preflightCheckpointPath ? options.preflightCheckpointPath.replace(/\.json$/i, '.running.json') : undefined,
      items,
      options,
      fingerprint,
      'preflight_running',
    );
  });
  await writePreflightCheckpoint(options.preflightCheckpointPath, items, options, fingerprint, 'preflight_done');
}

async function runStageCheck(
  items: StageSourceWorkItem[],
  options: NormalizedIptvPickerCoreRuntimeOptions,
): Promise<void> {
  for (const item of items.filter((sourceItem) => !sourceItem.finishedAt && sourceItem.preflightItems.length === 0)) {
    item.finishedAt = new Date().toISOString();
    emitDetailLog(options, 'source:done', {
      index: `${item.index}/${item.totalSources}`,
      sourceName: item.source.name,
      sourceUrl: item.source.url,
      status: item.entries.some((entry) => entry.ok) ? 'ok' : 'failed',
      reason: item.curatedItems.length === 0 ? '没有可检测URL' : '预检无通过URL',
      groups: item.curatedStats.groups,
      channels: item.curatedStats.channels,
      urls: item.curatedStats.urls,
      ok: item.entries.filter((entry) => entry.ok).length,
      failed: item.entries.filter((entry) => !entry.ok).length,
      downloadMs: item.timing.downloadMs,
      parseMs: item.timing.parseMs,
      curationMs: item.timing.curationMs,
      preflightMs: item.timing.preflightMs,
      lintMs: item.timing.lintMs,
      checkMs: item.timing.checkMs,
      durationMs: Date.now() - Date.parse(item.startedAt),
    });
  }

  await mapLimit(items.filter((item) => item.preflightItems.length > 0), options.sourceParallel, async (item) => {
    const checkStart = Date.now();
    try {
      if (options.noFfmpegMode) {
        const checkedEntries = buildNoFfmpegEntries(item.preflightItems, item.source);
        for (const entry of checkedEntries) emitUrlCheckResult(options, entry, 'skipped');
        item.entries.push(...checkedEntries);
      } else {
        const engine: IptvPickerCoreChannelEntry['engine'] = options.checkMode === 'fast' ? 'ffprobe-fast' : 'iptv-checker';
        const checkedItems = options.checkMode === 'fast'
          ? await checkPlaylistFast(item.preflightItems, options, item.source)
          : await checkPlaylistFull(item.preflightItems, options, item.source);
        item.entries.push(...checkedItems
          .filter((checked) => typeof checked.url === 'string' && checked.url.trim())
          .map((checked) => normalizeCheckedItem(checked, item.source, engine)));
      }
    } catch (error) {
      item.entries.push({
        bareUrl: item.source.url,
        ok: false,
        engine: options.checkMode === 'fast' ? 'ffprobe-fast' : 'iptv-checker',
        checkedAt: new Date().toISOString(),
        errorCode: 'CHECK_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
        sourceUrl: item.source.url,
        sourceName: item.source.name,
      });
    }
    item.timing.checkMs = Date.now() - checkStart;
    item.finishedAt = new Date().toISOString();
    emitDetailLog(options, 'source:done', {
      index: `${item.index}/${item.totalSources}`,
      sourceName: item.source.name,
      sourceUrl: item.source.url,
      status: item.entries.some((entry) => entry.ok) ? 'ok' : 'failed',
      groups: item.curatedStats.groups,
      channels: item.curatedStats.channels,
      urls: item.curatedStats.urls,
      ok: item.entries.filter((entry) => entry.ok).length,
      failed: item.entries.filter((entry) => !entry.ok).length,
      downloadMs: item.timing.downloadMs,
      parseMs: item.timing.parseMs,
      curationMs: item.timing.curationMs,
      preflightMs: item.timing.preflightMs,
      checkMs: item.timing.checkMs,
      durationMs: Date.now() - Date.parse(item.startedAt),
    });
  });
}

function buildResultFromStageItems(
  items: StageSourceWorkItem[],
  status: IptvPickerCoreFileResult['status'],
  startedAt: string,
  startMs: number,
  options: NormalizedIptvPickerCoreRuntimeOptions,
): IptvPickerCoreFileResult {
  const finishedAt = new Date().toISOString();
  const entries = items.flatMap((item) => item.entries);
  const sourceTimings = items.map(sourceTimingFromWorkItem);
  return {
    generatedAt: new Date().toISOString(),
    runtime: {
      nodeSupported: true,
      ffprobeAvailable: options.ffprobeAvailable,
      ffprobePath: options.ffprobePath,
      ffprobeSource: options.ffprobeSource,
      noFfmpegMode: options.noFfmpegMode,
      requireFfmpeg: options.requireFfmpeg,
      checkMode: options.checkMode,
      playbackValidation: options.noFfmpegMode ? 'no-ffmpeg' : 'ffmpeg',
    },
    status: {
      ...status,
      state: 'done',
      checkedSources: items.length,
      totalUrls: entries.length,
      checkedUrls: entries.length,
      okUrls: entries.filter((entry) => entry.ok).length,
      failedUrls: entries.filter((entry) => !entry.ok).length,
      finishedAt,
      durationMs: Date.now() - startMs,
    },
    report: buildIptvPickerCoreReportFromEntries(entries),
    entries,
    timing: {
      startedAt,
      finishedAt,
      durationMs: Date.now() - startMs,
      totals: {
        downloadMs: sourceTimings.reduce((sum, item) => sum + item.downloadMs, 0),
        parseMs: sourceTimings.reduce((sum, item) => sum + item.parseMs, 0),
        curationMs: sourceTimings.reduce((sum, item) => sum + item.curationMs, 0),
        preflightMs: sourceTimings.reduce((sum, item) => sum + item.preflightMs, 0),
        lintMs: sourceTimings.reduce((sum, item) => sum + item.lintMs, 0),
        checkMs: sourceTimings.reduce((sum, item) => sum + item.checkMs, 0),
      },
      sources: sourceTimings,
    },
  };
}

async function checkIptvPickerCoreSourcesByStage(
  sources: IptvPickerCoreInputSource[],
  onProgress: ((status: IptvPickerCoreFileResult['status'], event?: IptvPickerCoreProgressEvent) => void) | undefined,
  options: NormalizedIptvPickerCoreRuntimeOptions,
  startedAt: string,
  startMs: number,
  status: IptvPickerCoreFileResult['status'],
): Promise<IptvPickerCoreFileResult> {
  const fingerprint = runtimeFingerprint(sources, options);
  const resume = await readPreflightCheckpoint(options.resumePreflightPath);
  let items: StageSourceWorkItem[] | null = null;

  emitStageLog(options, 'start', 1, '加载准备', { sources: sources.length, pipelineMode: options.pipelineMode });
  if (resume) {
    if (resume.state === 'preflight_done' && resume.fingerprint === fingerprint) {
      items = restoreWorkItemsFromCheckpoint(resume, sources);
      emitStageLog(options, 'resume', 1, '加载准备', {
        file: options.resumePreflightPath,
        sources: items.length,
        message: '预检检查点匹配，跳过下载、格式检查、解析、规则过滤和预检阶段',
      });
    } else {
      emitStageLog(options, 'resume-mismatch', 1, '加载准备', {
        file: options.resumePreflightPath,
        checkpointState: resume.state,
        reason: resume.state !== 'preflight_done' ? '预检检查点未完成' : '预检检查点指纹不一致',
        message: '恢复条件不一致，重新开始完整阶段流程',
      });
    }
  } else if (options.resumePreflightPath) {
    emitStageLog(options, 'resume-mismatch', 1, '加载准备', {
      file: options.resumePreflightPath,
      reason: '预检检查点不存在或无法解析',
      message: '恢复条件不一致，重新开始完整阶段流程',
    });
  }
  if (!items) {
    items = sources.map((source, index) => createStageWorkItem(source, index + 1, sources.length));
  }
  emitStageLog(options, 'done', 1, '加载准备', { sources: items.length, durationMs: Date.now() - startMs });

  if (!resume || resume.state !== 'preflight_done' || resume.fingerprint !== fingerprint) {
    const downloadStageStart = Date.now();
    emitStageLog(options, 'start', 2, '下载与原始格式检查', { sources: items.length });
    await runStageDownloadAndLint(items, options);
    emitStageLog(options, 'done', 2, '下载与原始格式检查', {
      sources: items.length,
      downloadFailed: items.filter((item) => item.downloadFailed).length,
      m3uSources: items.filter((item) => item.contentIsM3u).length,
      lintErrorSources: items.filter((item) => item.lintErrors > 0).length,
      lintErrors: items.reduce((sum, item) => sum + item.lintErrors, 0),
      durationMs: Date.now() - downloadStageStart,
    });

    const parseStageStart = Date.now();
    emitStageLog(options, 'start', 3, '解析与频道规则过滤', { sources: items.length });
    await runStageParseAndCuration(items, options);
    emitStageLog(options, 'done', 3, '解析与频道规则过滤', {
      rawUrls: items.reduce((sum, item) => sum + item.rawStats.urls, 0),
      keptUrls: items.reduce((sum, item) => sum + item.curatedStats.urls, 0),
      droppedUrls: items.reduce((sum, item) => sum + Math.max(0, item.rawStats.urls - item.curatedStats.urls), 0),
      durationMs: Date.now() - parseStageStart,
    });

    const preflightStageStart = Date.now();
    emitStageLog(options, 'start', 4, 'HTTP预检', {
      sources: items.length,
      urls: items.reduce((sum, item) => sum + item.curatedItems.length, 0),
      checkpoint: options.preflightCheckpointPath,
    });
    await runStagePreflight(items, options, fingerprint);
    emitStageLog(options, 'done', 4, 'HTTP预检', {
      passed: items.reduce((sum, item) => sum + item.preflightItems.length, 0),
      failed: items.reduce((sum, item) => sum + item.preflightFailures.length, 0),
      skipped: items.reduce((sum, item) => sum + item.preflightSkipped, 0),
      checkpoint: options.preflightCheckpointPath,
      durationMs: Date.now() - preflightStageStart,
    });
  }

  const checkStageStart = Date.now();
  const submittedCheckUrls = items.reduce((sum, item) => sum + item.preflightItems.length, 0);
  emitStageLog(options, 'start', 5, '播放检测', {
    sources: items.length,
    submittedUrls: submittedCheckUrls,
  });
  await runStageCheck(items, options);
  const allStageEntries = items.flatMap((item) => item.entries);
  const playbackEntries = allStageEntries.filter(isPlaybackCheckEntry);
  const preflightFailedEntries = allStageEntries.filter((entry) => isPreflightErrorCode(entry.errorCode));
  status.checkedSources = items.length;
  status.totalUrls = allStageEntries.length;
  status.checkedUrls = status.totalUrls;
  status.okUrls = allStageEntries.filter((entry) => entry.ok).length;
  status.failedUrls = allStageEntries.filter((entry) => !entry.ok).length;
  emitStageLog(options, 'done', 5, '播放检测', {
    submittedUrls: submittedCheckUrls,
    checkOk: playbackEntries.filter((entry) => entry.ok).length,
    checkFailed: playbackEntries.filter((entry) => !entry.ok).length,
    preflightFailed: preflightFailedEntries.length,
    cumulativeEntries: allStageEntries.length,
    durationMs: Date.now() - checkStageStart,
  });
  onProgress?.({ ...status }, {
    status: { ...status },
    sourceEntries: allStageEntries,
    allEntries: allStageEntries,
  });

  const finalizeStageStart = Date.now();
  emitStageLog(options, 'start', 6, '汇总导出', {
    entries: items.flatMap((item) => item.entries).length,
  });
  const result = buildResultFromStageItems(items, status, startedAt, startMs, options);
  emitStageLog(options, 'done', 6, '汇总导出', {
    entries: result.entries.length,
    ok: result.entries.filter((entry) => entry.ok).length,
    failed: result.entries.filter((entry) => !entry.ok).length,
    durationMs: Date.now() - finalizeStageStart,
  });
  return result;
}

export async function checkIptvPickerCoreSources(
  sources: IptvPickerCoreInputSource[],
  onProgress?: (status: IptvPickerCoreFileResult['status'], event?: IptvPickerCoreProgressEvent) => void,
  options?: IptvPickerCoreRuntimeOptions,
): Promise<IptvPickerCoreFileResult> {
  const runtimeOptions = normalizeRuntimeOptions(options);
  const runtime = await getIptvPickerCoreRuntime({ ffprobePath: runtimeOptions.ffprobePath });
  runtimeOptions.ffprobeAvailable = runtime.ffprobeAvailable;
  runtimeOptions.ffprobePath = runtime.ffprobePath;
  runtimeOptions.ffprobeSource = runtime.ffprobeSource;
  runtimeOptions.noFfmpegMode = !runtime.ffprobeAvailable;
  if (!runtime.nodeSupported) {
    throw new Error('Node.js >= 22.12.0 is required by iptv-checker.');
  }
  if (runtimeOptions.requireFfmpeg && !runtime.ffprobeAvailable) {
    throw new Error('ffprobe not found. Install ffmpeg and ensure ffprobe is in PATH, or run without --require-ffmpeg to use no-ffmpeg mode.');
  }
  if (runtimeOptions.noFfmpegMode) {
    emitDetailLog(runtimeOptions, 'runtime:ffmpeg:missing', {
      mode: 'no-ffmpeg',
      message: 'ffprobe not found. Running in no-ffmpeg mode; playback quality is not verified.',
    });
  }

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const status: IptvPickerCoreFileResult['status'] = {
    state: 'running',
    startedAt,
    totalSources: sources.length,
    checkedSources: 0,
    totalUrls: 0,
    checkedUrls: 0,
    okUrls: 0,
    failedUrls: 0,
  };
  onProgress?.({ ...status }, { status: { ...status }, allEntries: [] });

  if (runtimeOptions.pipelineMode === 'stage') {
    return checkIptvPickerCoreSourcesByStage(sources, onProgress, runtimeOptions, startedAt, startMs, status);
  }

  const entries: IptvPickerCoreChannelEntry[] = [];
  const sourceTimings: IptvPickerCoreSourceTiming[] = [];

  await mapLimit(sources.map((source, index) => ({ source, index })), runtimeOptions.sourceParallel, async ({ source, index }) => {
    status.currentSourceName = source.name;
    status.currentSourceUrl = source.url;
    status.currentSourceIndex = index + 1;
    status.currentSourceStartedAt = new Date().toISOString();
    status.currentSourceElapsedMs = 0;

    const checked = await checkSourceToEntries(source, runtimeOptions, index + 1, sources.length);
    const sourceEntries = checked.entries;
    sourceTimings.push(checked.timing);
    entries.push(...sourceEntries);

    status.checkedSources++;
    status.totalUrls += sourceEntries.length;
    status.checkedUrls += sourceEntries.length;
    status.okUrls += sourceEntries.filter((entry) => entry.ok).length;
    status.failedUrls += sourceEntries.filter((entry) => !entry.ok).length;
    status.currentSourceElapsedMs = checked.timing.durationMs;
    status.lastFinishedSourceName = checked.timing.sourceName;
    status.lastFinishedSourceUrl = checked.timing.sourceUrl;
    status.lastFinishedSourceDurationMs = checked.timing.durationMs;
    status.lastFinishedSourceDownloadMs = checked.timing.downloadMs;
    status.lastFinishedSourceParseMs = checked.timing.parseMs;
    status.lastFinishedSourceCurationMs = checked.timing.curationMs;
    status.lastFinishedSourcePreflightMs = checked.timing.preflightMs;
    status.lastFinishedSourceLintMs = checked.timing.lintMs;
    status.lastFinishedSourceCheckMs = checked.timing.checkMs;
    onProgress?.({ ...status }, {
      status: { ...status },
      sourceEntries: sourceEntries.slice(),
      sourceTiming: checked.timing,
      allEntries: entries.slice(),
    });
  });

  const finishedAt = new Date().toISOString();
  return {
    generatedAt: new Date().toISOString(),
    runtime: {
      nodeSupported: runtime.nodeSupported,
      ffprobeAvailable: runtime.ffprobeAvailable,
      ffprobePath: runtime.ffprobePath,
      ffprobeSource: runtime.ffprobeSource,
      noFfmpegMode: runtimeOptions.noFfmpegMode,
      requireFfmpeg: runtimeOptions.requireFfmpeg,
      checkMode: runtimeOptions.checkMode,
      playbackValidation: runtimeOptions.noFfmpegMode ? 'no-ffmpeg' : 'ffmpeg',
    },
    status: {
      ...status,
      state: 'done',
      finishedAt,
      durationMs: Date.now() - startMs,
    },
    report: buildIptvPickerCoreReportFromEntries(entries),
    entries,
    timing: {
      startedAt,
      finishedAt,
      durationMs: Date.now() - startMs,
      totals: {
        downloadMs: sourceTimings.reduce((sum, item) => sum + item.downloadMs, 0),
        parseMs: sourceTimings.reduce((sum, item) => sum + item.parseMs, 0),
        curationMs: sourceTimings.reduce((sum, item) => sum + item.curationMs, 0),
        preflightMs: sourceTimings.reduce((sum, item) => sum + item.preflightMs, 0),
        lintMs: sourceTimings.reduce((sum, item) => sum + item.lintMs, 0),
        checkMs: sourceTimings.reduce((sum, item) => sum + item.checkMs, 0),
      },
      sources: sourceTimings,
    },
  };
}
