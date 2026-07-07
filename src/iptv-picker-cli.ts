#!/usr/bin/env node

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, extname, resolve } from 'path';
import {
  buildIptvPickerCoreReportFromEntries,
  checkIptvPickerCoreSources,
  DEFAULT_CHECK_MODE,
  DEFAULT_CHECK_RETRY,
  DEFAULT_CHECK_TIMEOUT_MS,
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
  DEFAULT_HOST_TIMEOUT_LIMIT,
  DEFAULT_PREFLIGHT,
  DEFAULT_PREFLIGHT_TIMEOUT_MS,
  DEFAULT_SOURCE_PARALLEL,
  DEFAULT_PREFLIGHT_PARALLEL,
  DEFAULT_PREFLIGHT_HOST_PARALLEL,
  DEFAULT_CHECK_PARALLEL,
  DEFAULT_CHECK_HOST_PARALLEL,
  DEFAULT_PIPELINE_MODE,
  type IptvPickerCoreCheckMode,
  type IptvPickerCoreDetailLogEvent,
  type IptvPickerCoreFileResult,
  type IptvPickerCoreInputSource,
  type IptvPickerCorePipelineMode,
  type IptvPickerCoreProgressEvent,
} from './core/iptv-picker-core';
import { createChannelNameMatcher, curateChannelEntries, loadChannelAliases, loadChannelTargets } from './core/channel-curation';
import type {
  ChannelCurationPreset,
  IptvPickerCoreChannelEntry,
  IptvPickerCoreReport,
  IptvPickerCoreSourceSummary,
} from './core/types';

interface InquirerPrompts {
  input(options: {
    message: string;
    default?: string;
    validate?: (value: string) => boolean | string | Promise<boolean | string>;
  }): Promise<string>;
  confirm(options: {
    message: string;
    default: boolean;
  }): Promise<boolean>;
  select<T extends string>(options: {
    message: string;
    choices: Array<{
      name: string;
      value: T;
      description: string;
    }>;
    default: T;
  }): Promise<T>;
}

let inquirerPromptsPromise: Promise<InquirerPrompts> | undefined;

function loadInquirerPrompts(): Promise<InquirerPrompts> {
  inquirerPromptsPromise ??= import('@inquirer/prompts') as Promise<InquirerPrompts>;
  return inquirerPromptsPromise;
}

interface CliArgs {
  url?: string;
  name?: string;
  input?: string;
  out: string;
  reportOut?: string;
  sourceStatsOut?: string;
  channelStatsOut?: string;
  exportLive?: string;
  exportFormat: LiveExportFormat;
  exportAll: boolean;
  noReport: boolean;
  noMdReports: boolean;
  noProgressOutput: boolean;
  stdoutReport: boolean;
  compact: boolean;
  quiet: boolean;
  log: boolean;
  noLog: boolean;
  debug: boolean;
  logOut?: string;
  downloadTimeoutMs: number;
  checkTimeoutMs: number;
  checkRetry: number;
  checkMode: IptvPickerCoreCheckMode;
  requireFfmpeg: boolean;
  ffprobePath?: string;
  preflight: boolean;
  preflightTimeoutMs: number;
  hostTimeoutLimit: number;
  sourceParallel: number;
  preflightParallel: number;
  preflightHostParallel: number;
  checkParallel: number;
  checkHostParallel: number;
  pipelineMode: IptvPickerCorePipelineMode;
  preflightOut: string;
  resumePreflight?: string;
  runtimeCliOverrides?: {
    downloadTimeoutMs?: boolean;
    checkTimeoutMs?: boolean;
    checkRetry?: boolean;
    checkMode?: boolean;
    requireFfmpeg?: boolean;
    ffprobePath?: boolean;
    preflight?: boolean;
    preflightTimeoutMs?: boolean;
    hostTimeoutLimit?: boolean;
    sourceParallel?: boolean;
    preflightParallel?: boolean;
    preflightHostParallel?: boolean;
    checkParallel?: boolean;
    checkHostParallel?: boolean;
    pipelineMode?: boolean;
    curationPreFilter?: boolean;
  };
  curationCliOverrides?: {
    preset?: boolean;
    keepPerChannel?: boolean;
    preferredMinHeight?: boolean;
    fallbackMinHeight?: boolean;
    allowLowResFallback?: boolean;
    preFilter?: boolean;
    includeUnmatched?: boolean;
    includeFailed?: boolean;
  };
  topErrors: number;
  topSources: number;
  strategy?: StrategyKey;
  status: 'all' | 'ok' | 'failed';
  source?: string;
  group?: string;
  channel?: string;
  errorCode?: string;
  minHeight?: number;
  sort: SortKey;
  sortDir: 'asc' | 'desc';
  reportSort: ReportSortKey;
  reportSortDir: 'asc' | 'desc';
  strategyFile: string;
  curationPreset: ChannelCurationPreset;
  curationKeepPerChannel?: number;
  curationPreferredMinHeight?: number;
  curationFallbackMinHeight?: number;
  curationAllowLowResFallback: boolean;
  curationPreFilter: boolean;
  curationIncludeUnmatched: boolean;
  curationIncludeFailed: boolean;
  curationTargetsFile: string;
  curationAliasesFile: string;
  publishSyncConfigFile: string;
  noPublishSync: boolean;
  publishSyncOnly: boolean;
  initDefaultSources?: boolean;
  initDefaultStrategies?: boolean;
  initDefaultChannelTargets?: boolean;
  initDefaultChannelAliases?: boolean;
  listStrategies?: boolean;
  help?: boolean;
  interactive?: boolean;
}

type SortKey =
  | 'default'
  | 'status'
  | 'source'
  | 'group'
  | 'channel'
  | 'resolution'
  | 'bitrate'
  | 'fps'
  | 'error'
  | 'url';

type ReportSortKey = 'default' | 'source' | 'total' | 'ok' | 'failed' | 'ok-rate' | 'checked-at';
type LiveExportFormat = 'm3u' | 'txt' | 'json';
type StrategyKey = string;

interface StrategyDefinition {
  key: StrategyKey;
  label: string;
  description: string;
  enabled?: boolean;
  apply: Partial<Pick<CliArgs,
    | 'status'
    | 'source'
    | 'group'
    | 'channel'
    | 'errorCode'
    | 'minHeight'
    | 'sort'
    | 'sortDir'
    | 'reportSort'
    | 'reportSortDir'
    | 'exportAll'
    | 'curationPreset'
    | 'curationKeepPerChannel'
    | 'curationPreferredMinHeight'
    | 'curationFallbackMinHeight'
    | 'curationAllowLowResFallback'
    | 'curationPreFilter'
    | 'curationIncludeUnmatched'
    | 'curationIncludeFailed'
    | 'downloadTimeoutMs'
    | 'checkTimeoutMs'
    | 'checkRetry'
    | 'checkMode'
    | 'preflight'
    | 'preflightTimeoutMs'
    | 'hostTimeoutLimit'
    | 'sourceParallel'
    | 'preflightParallel'
    | 'preflightHostParallel'
    | 'checkParallel'
    | 'checkHostParallel'
    | 'pipelineMode'
  >>;
}

interface StrategyConfigFile {
  _comment?: string;
  _schemaNotes?: Record<string, unknown>;
  generatedAt?: string;
  purpose?: string;
  defaultStrategy?: string;
  strategies?: StrategyConfigItem[];
  channelCuration?: {
    defaultPreset?: ChannelCurationPreset;
  };
}

interface StrategyConfigItem {
  key?: unknown;
  label?: unknown;
  description?: unknown;
  enabled?: unknown;
  filters?: {
    status?: unknown;
    source?: unknown;
    group?: unknown;
    channel?: unknown;
    errorCode?: unknown;
    minHeight?: unknown;
  };
  sort?: {
    entry?: unknown;
    entryDir?: unknown;
    report?: unknown;
    reportDir?: unknown;
  };
  export?: {
    exportAll?: unknown;
  };
  runtime?: {
    downloadTimeoutMs?: unknown;
    checkTimeoutMs?: unknown;
    checkRetry?: unknown;
    checkMode?: unknown;
    preflight?: unknown;
    preflightTimeoutMs?: unknown;
    hostTimeoutLimit?: unknown;
    sourceParallel?: unknown;
    preflightParallel?: unknown;
    preflightHostParallel?: unknown;
    checkParallel?: unknown;
    checkHostParallel?: unknown;
    pipelineMode?: unknown;
  };
  curation?: {
    preset?: unknown;
    keepPerChannel?: unknown;
    preferredMinHeight?: unknown;
    fallbackMinHeight?: unknown;
    allowLowResFallback?: unknown;
    preFilter?: unknown;
    includeUnmatched?: unknown;
    includeFailed?: unknown;
  };
}

function isCurationPreset(value: unknown): value is ChannelCurationPreset {
  return value === 'none' || value === 'cn' || value === 'cn-full' || value === 'cn-plus';
}

const STRATEGIES: StrategyDefinition[] = [
  {
    key: 'balanced',
    label: '均衡优选',
    description: '代码内置兜底策略；完整策略请使用 config/strategy.json 配置。',
    apply: {
      status: 'ok',
      sort: 'default',
      sortDir: 'asc',
      reportSort: 'default',
      reportSortDir: 'desc',
      exportAll: false,
      curationKeepPerChannel: 1,
      curationPreferredMinHeight: 1080,
      curationFallbackMinHeight: 720,
      curationAllowLowResFallback: true,
    },
  },
];

interface SourceLoadResult {
  sources: IptvPickerCoreInputSource[];
  rawSourceCount: number;
  droppedSourceCount: number;
  inputMode: 'url' | 'input';
  inputFile?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

const DEFAULT_INPUT_PATH = resolve('data', 'source.json');
const DEFAULT_OUTPUT_PATH = 'res/res.json';
const DEFAULT_LIVE_EXPORT_PATH = 'res/iptv.m3u';
const DEFAULT_PREFLIGHT_OUTPUT_PATH = 'res/res.preflight.json';
const DEFAULT_STRATEGY_PATH = resolve('config', 'strategy.json');
const DEFAULT_CHANNEL_TARGETS_PATH = resolve('config', 'channel-targets.json');
const DEFAULT_CHANNEL_ALIASES_PATH = resolve('config', 'channel-aliases.json');
const DEFAULT_LOG_PATH = 'res/res.log';
const DEFAULT_PUBLISH_DIR = 'publish';
const DEFAULT_PUBLISH_SYNC_CONFIG_PATH = resolve('config', 'publish-sync.json');

type RemotePublishTargetType = 'webdav' | 'http-post' | 'http-get';
type RemotePostMode = 'multipart' | 'json' | 'binary';

interface RemotePublishConfigFile {
  enabled?: unknown;
  failOnRemoteError?: unknown;
  timeoutMs?: unknown;
  targets?: RemotePublishTargetConfig[];
}

interface RemotePublishTargetConfig {
  type?: unknown;
  name?: unknown;
  enabled?: unknown;
  files?: unknown;
  timeoutMs?: unknown;
  baseUrl?: unknown;
  baseUrlEnv?: unknown;
  username?: unknown;
  usernameEnv?: unknown;
  password?: unknown;
  passwordEnv?: unknown;
  remoteDir?: unknown;
  pathParam?: unknown;
  contentType?: unknown;
  url?: unknown;
  urlEnv?: unknown;
  token?: unknown;
  tokenEnv?: unknown;
  authHeader?: unknown;
  mode?: unknown;
  fields?: unknown;
  headers?: unknown;
}

interface RemotePublishResolvedTarget {
  type: RemotePublishTargetType;
  name: string;
  enabled: boolean;
  files?: string[];
  timeoutMs?: number;
  baseUrl?: string;
  username?: string;
  password?: string;
  remoteDir?: string;
  pathParam?: string;
  contentType?: string;
  url?: string;
  token?: string;
  authHeader?: string;
  mode?: RemotePostMode;
  fields?: Record<string, string>;
  headers?: Record<string, string>;
}

interface RemotePublishResolvedConfig {
  enabled: boolean;
  failOnRemoteError: boolean;
  timeoutMs: number;
  targets: RemotePublishResolvedTarget[];
}

type RemotePublishResult = NonNullable<NonNullable<IptvPickerCoreFileResult['output']>['remotePublish']>[number];

let runtimeLogPath: string | undefined;
let runtimeDebug = false;
let runtimeLogBuffer: string[] = [];
let runtimeLogFlushTimer: NodeJS.Timeout | undefined;
let currentCliArgs: CliArgs | undefined;

function defaultSourceCatalog() {
  return {
    generatedAt: new Date().toISOString(),
    purpose: 'Default open-source IPTV source list for IPTV Picker CLI.',
    notes: [
      'These are public/open-source playlists meant for quality checking, not direct auto-publishing.',
      'You can edit, add, or remove sources before running detection.',
      'Set enabled=false for local/self-hosted placeholders until you replace them with your own reachable URL.',
    ],
    sources: [
      {
        name: "iptv-org all channels",
        url: "https://iptv-org.github.io/iptv/index.m3u",
        sourceKind: "candidate",
      },
      {
        name: "iptv-org Chinese language",
        url: "https://iptv-org.github.io/iptv/languages/zho.m3u",
        sourceKind: "candidate",
      },
      {
        name: "iptv-org China mainland",
        url: "https://iptv-org.github.io/iptv/countries/cn.m3u",
        sourceKind: "candidate",
      },
      {
        name: "iptv-org Hong Kong",
        url: "https://iptv-org.github.io/iptv/countries/hk.m3u",
        sourceKind: "candidate",
      },
      {
        name: "iptv-org Taiwan",
        url: "https://iptv-org.github.io/iptv/countries/tw.m3u",
        sourceKind: "candidate",
      },
      {
        name: "Free-TV IPTV playlist",
        url: "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8",
        sourceKind: "candidate",
      },
      {
        name: "suxuang myIPTV IPv6",
        url: "https://mirror.ghproxy.com/raw.githubusercontent.com/suxuang/myIPTV/main/ipv6.m3u",
        sourceKind: "candidate",
      },
      {
        name: "zbds IPTV4 M3U",
        url: "https://live.zbds.top/tv/iptv4.m3u",
        sourceKind: "candidate",
      },
      {
        name: "fanmingming live IPv6",
        url: "https://live.fanmingming.com/tv/m3u/ipv6.m3u",
        sourceKind: "candidate",
      },
      {
        name: "YueChan Live IPTV",
        url: "https://raw.githubusercontent.com/YueChan/Live/main/IPTV.m3u",
        sourceKind: "candidate",
      },
      {
        name: "YanG-1989 Gather",
        url: "https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u",
        sourceKind: "candidate",
      },
      {
        name: "Guovin iptv-api M3U",
        url: "https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/result.m3u",
        sourceKind: "candidate",
      },
      {
        name: "Guovin iptv-api TXT",
        url: "https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/result.txt",
        sourceKind: "candidate",
      },
      {
        name: "BurningC4 Chinese IPTV IPv4",
        url: "https://raw.githubusercontent.com/BurningC4/Chinese-IPTV/master/TV-IPV4.m3u",
        sourceKind: "candidate",
      },
      {
        name: "vamoschuck TV M3U",
        url: "https://raw.githubusercontent.com/vamoschuck/TV/main/M3U",
        sourceKind: "candidate",
      },
      {
        name: "肥羊 AllInOne local M3U template",
        url: "http://127.0.0.1:35455/tv.m3u",
        sourceKind: "manual",
        enabled: false,
        notes: "Deploy 肥羊 allinone locally, replace host/port with your reachable address, then set enabled=true.",
      },
      {
        name: "vbskycn IPTV4 M3U",
        url: "https://raw.githubusercontent.com/vbskycn/iptv/master/tv/iptv4.m3u",
        sourceKind: "candidate",
      },
      {
        name: "vbskycn IPTV4 TXT",
        url: "https://raw.githubusercontent.com/vbskycn/iptv/master/tv/iptv4.txt",
        sourceKind: "candidate",
      },
      {
        name: "vbskycn IPTV6 M3U",
        url: "https://raw.githubusercontent.com/vbskycn/iptv/master/tv/iptv6.m3u",
        sourceKind: "candidate",
      },
      {
        name: "vbskycn IPTV6 TXT",
        url: "https://raw.githubusercontent.com/vbskycn/iptv/master/tv/iptv6.txt",
        sourceKind: "candidate",
      },
      {
        name: "live.iptv365 live M3U",
        url: "https://live.iptv365.org/live.m3u",
        sourceKind: "candidate",
      },
      {
        name: "live.iptv365 live TXT",
        url: "https://live.iptv365.org/live.txt",
        sourceKind: "candidate",
      },
      {
        name: "kimwang1978 collect-txt live M3U",
        url: "https://raw.githubusercontent.com/kimwang1978/collect-txt/main/live.m3u",
        sourceKind: "candidate",
      },
      {
        name: "kimwang1978 collect-txt live TXT",
        url: "https://raw.githubusercontent.com/kimwang1978/collect-txt/main/live.txt",
        sourceKind: "candidate",
      },
      {
        name: "kimwang1978 collect-txt live lite M3U",
        url: "https://raw.githubusercontent.com/kimwang1978/collect-txt/main/live_lite.m3u",
        sourceKind: "candidate",
      },
      {
        name: "kimwang1978 collect-txt live lite TXT",
        url: "https://raw.githubusercontent.com/kimwang1978/collect-txt/main/live_lite.txt",
        sourceKind: "candidate",
      },
      {
        name: "kimwang1978 collect-txt merged M3U",
        url: "https://raw.githubusercontent.com/kimwang1978/collect-txt/main/merged_output.m3u",
        sourceKind: "candidate",
      },
      {
        name: "kimwang1978 collect-txt merged TXT",
        url: "https://raw.githubusercontent.com/kimwang1978/collect-txt/main/merged_output.txt",
        sourceKind: "candidate",
      },
      {
        name: "Guovin iptv-api IPv4 M3U",
        url: "https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/ipv4/result.m3u",
        sourceKind: "candidate",
      },
      {
        name: "Guovin iptv-api IPv4 TXT",
        url: "https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/ipv4/result.txt",
        sourceKind: "candidate",
      },
      {
        name: "Guovin iptv-api IPv6 M3U",
        url: "https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/ipv6/result.m3u",
        sourceKind: "candidate",
      },
      {
        name: "Guovin iptv-api IPv6 TXT",
        url: "https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/ipv6/result.txt",
        sourceKind: "candidate",
      },
      {
        name: "Kimentanm APTV IPTV M3U",
        url: "https://raw.githubusercontent.com/Kimentanm/aptv/master/m3u/iptv.m3u",
        sourceKind: "candidate",
      },
      {
        name: "zhumeng11 IPTV M3U",
        url: "https://raw.githubusercontent.com/zhumeng11/IPTV/main/IPTV.m3u",
        sourceKind: "candidate",
      },
      {
        name: "drangjchen IPTV IPv6 M3U",
        url: "https://raw.githubusercontent.com/drangjchen/IPTV/main/M3U/ipv6.m3u",
        sourceKind: "candidate",
      },
      {
        name: "liu673cn box IPv6 M3U",
        url: "https://raw.githubusercontent.com/liu673cn/box/main/libs/tv/ipv6.m3u",
        sourceKind: "candidate",
      },
      {
        name: "BigBigGrandG IPTV-URL Gather M3U",
        url: "https://raw.githubusercontent.com/BigBigGrandG/IPTV-URL/release/Gather.m3u",
        sourceKind: "candidate",
      },
      {
        name: "yuanzl77 IPTV live M3U",
        url: "https://raw.githubusercontent.com/yuanzl77/IPTV/main/live.m3u",
        sourceKind: "candidate",
      },
      {
        name: "SCXSVIP TV live TXT",
        url: "https://raw.githubusercontent.com/SCXSVIP/TV/main/live.txt",
        sourceKind: "candidate",
      },
      {
        name: "iptv-org United States",
        url: "https://iptv-org.github.io/iptv/countries/us.m3u",
        sourceKind: "candidate",
      },
      {
        name: "iptv-org United Kingdom",
        url: "https://iptv-org.github.io/iptv/countries/uk.m3u",
        sourceKind: "candidate",
      },
      {
        name: "iptv-org Canada",
        url: "https://iptv-org.github.io/iptv/countries/ca.m3u",
        sourceKind: "candidate",
      },
      {
        name: "iptv-org Japan",
        url: "https://iptv-org.github.io/iptv/countries/jp.m3u",
        sourceKind: "candidate",
      },
      {
        name: "iptv-org Singapore",
        url: "https://iptv-org.github.io/iptv/countries/sg.m3u",
        sourceKind: "candidate",
      },
      {
        name: "iptv-org Malaysia",
        url: "https://iptv-org.github.io/iptv/countries/my.m3u",
        sourceKind: "candidate",
      },
      {
        name: "iptv-org Macau",
        url: "https://iptv-org.github.io/iptv/countries/mo.m3u",
        sourceKind: "candidate",
      },
      {
        name: "iptv-org Korea",
        url: "https://iptv-org.github.io/iptv/countries/kr.m3u",
        sourceKind: "candidate",
      },
      {
        name: "iptv-org English language",
        url: "https://iptv-org.github.io/iptv/languages/eng.m3u",
        sourceKind: "candidate",
      },
      {
        name: "iptv-org Japanese language",
        url: "https://iptv-org.github.io/iptv/languages/jpn.m3u",
        sourceKind: "candidate",
      },
      {
        name: "iptv-org Korean language",
        url: "https://iptv-org.github.io/iptv/languages/kor.m3u",
        sourceKind: "candidate",
      },
      {
        name: "iptv-org movies category",
        url: "https://iptv-org.github.io/iptv/categories/movies.m3u",
        sourceKind: "candidate",
      },
      {
        name: "iptv-org news category",
        url: "https://iptv-org.github.io/iptv/categories/news.m3u",
        sourceKind: "candidate",
      },
      {
        name: "iptv-org sports category",
        url: "https://iptv-org.github.io/iptv/categories/sports.m3u",
        sourceKind: "candidate",
      },
      {
        name: "apsattv Roku",
        url: "https://www.apsattv.com/rok.m3u",
        sourceKind: "candidate",
      },
      {
        name: "apsattv Tablo",
        url: "https://www.apsattv.com/tablo.m3u",
        sourceKind: "candidate",
      },
      {
        name: "apsattv LocalNow",
        url: "https://www.apsattv.com/localnow.m3u",
        sourceKind: "candidate",
      },
      {
        name: "apsattv FireTV",
        url: "https://www.apsattv.com/firetv.m3u",
        sourceKind: "candidate",
      },
      {
        name: "apsattv LG Channels",
        url: "https://www.apsattv.com/lg.m3u",
        sourceKind: "candidate",
      },
      {
        name: "apsattv Vizio TV",
        url: "https://www.apsattv.com/vizio.m3u",
        sourceKind: "candidate",
      },
      {
        name: "apsattv Distro",
        url: "https://www.apsattv.com/distro.m3u",
        sourceKind: "candidate",
      },
      {
        name: "高稳推荐 IPTV4 TXT",
        url: "https://live.zbds.top/tv/iptv4.txt",
        sourceKind: "candidate",
        format: "diyp_txt",
        risk: "medium",
      },
      {
        name: "GitHub 高速镜像 IPTV4",
        url: "https://gh-proxy.org/raw.githubusercontent.com/vbskycn/iptv/refs/heads/master/tv/iptv4.m3u",
        sourceKind: "candidate",
        repo: "vbskycn/iptv",
        format: "m3u",
        risk: "medium",
        upstreamUrl: "https://raw.githubusercontent.com/vbskycn/iptv/refs/heads/master/tv/iptv4.m3u",
      },
      {
        name: "高稳推荐 IPTV6 M3U",
        url: "https://live.zbds.top/tv/iptv6.m3u",
        sourceKind: "candidate",
        format: "m3u",
        risk: "medium",
      },
      {
        name: "Collect-IPTV best_sorted",
        url: "https://raw.githubusercontent.com/zilong7728/Collect-IPTV/refs/heads/main/best_sorted.m3u",
        sourceKind: "candidate",
        repo: "zilong7728/Collect-IPTV",
        format: "m3u",
        risk: "medium",
      },
      {
        name: "三星TV+全球源",
        url: "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/refs/heads/main/playlists/samsungtvplus_all.m3u",
        sourceKind: "candidate",
        repo: "BuddyChewChew/app-m3u-generator",
        format: "m3u",
        risk: "medium",
      },
      {
        name: "Plex全球源",
        url: "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/refs/heads/main/playlists/plex_all.m3u",
        sourceKind: "candidate",
        repo: "BuddyChewChew/app-m3u-generator",
        format: "m3u",
        risk: "medium",
      },
      {
        name: "epg.pw 中国大陆地区分类源",
        url: "https://epg.pw/test_channels.m3u",
        sourceKind: "candidate",
        format: "m3u",
        risk: "medium",
      },
      {
        name: "epg.pw 香港地区分类源",
        url: "https://epg.pw/test_channels_hong_kong.m3u",
        sourceKind: "candidate",
        format: "m3u",
        risk: "medium",
      },
      {
        name: "epg.pw 台湾地区分类源",
        url: "https://epg.pw/test_channels_taiwan.m3u",
        sourceKind: "candidate",
        format: "m3u",
        risk: "medium",
      },
      {
        name: "epg.pw 新加坡地区分类源",
        url: "https://epg.pw/test_channels_singapore.m3u",
        sourceKind: "candidate",
        format: "m3u",
        risk: "medium",
      },
      {
        name: "epg.pw 马来西亚地区分类源",
        url: "https://epg.pw/test_channels_malaysia.m3u",
        sourceKind: "candidate",
        format: "m3u",
        risk: "medium",
      },
      {
        name: "中国之声",
        url: "https://ngcdn001.cnr.cn/live/zgzs/index.m3u8",
        content: "中国之声,https://ngcdn001.cnr.cn/live/zgzs/index.m3u8",
        sourceKind: "candidate",
        format: "m3u8",
        risk: "low_to_medium",
        notes: "Single-channel M3U8 from attachment; wrapped as DIYP one-line content so the checker can process it.",
      },
      {
        name: "凤凰资讯",
        url: "https://playtv-live.ifeng.com/live/06OLEEWQKN4_audio.m3u8",
        content: "凤凰资讯,https://playtv-live.ifeng.com/live/06OLEEWQKN4_audio.m3u8",
        sourceKind: "candidate",
        format: "m3u8",
        risk: "medium",
        notes: "Single-channel M3U8 from attachment; wrapped as DIYP one-line content so the checker can process it.",
      },
      {
        name: "qist ITV",
        url: "https://raw.githubusercontent.com/qist/tvbox/master/ITV.txt",
        sourceKind: "candidate",
        repo: "qist/tvbox",
        format: "diyp_txt",
        risk: "medium",
      },
      {
        name: "qist list.m3u",
        url: "https://raw.githubusercontent.com/qist/tvbox/master/list.m3u",
        sourceKind: "candidate",
        repo: "qist/tvbox",
        format: "m3u",
        risk: "medium",
      },
      {
        name: "qist livex.m3u",
        url: "https://raw.githubusercontent.com/qist/tvbox/master/livex.m3u",
        sourceKind: "candidate",
        repo: "qist/tvbox",
        format: "m3u",
        risk: "medium",
      },
      {
        name: "qist tvlive.txt",
        url: "https://raw.githubusercontent.com/qist/tvbox/master/tvlive.txt",
        sourceKind: "candidate",
        repo: "qist/tvbox",
        format: "diyp_txt",
        risk: "medium",
      },
      {
        name: "qist tvboxtv.txt",
        url: "https://raw.githubusercontent.com/qist/tvbox/master/tvboxtv.txt",
        sourceKind: "candidate",
        repo: "qist/tvbox",
        format: "diyp_txt",
        risk: "medium",
      },
      {
        name: "jinenge iptv.m3u",
        url: "https://raw.githubusercontent.com/jinenge/tvbox/main/lib/iptv.m3u",
        sourceKind: "candidate",
        repo: "jinenge/tvbox",
        format: "m3u",
        risk: "medium",
      },
      {
        name: "jinenge bililive.m3u",
        url: "https://raw.githubusercontent.com/jinenge/tvbox/main/lib/bililive.m3u",
        sourceKind: "candidate",
        repo: "jinenge/tvbox",
        format: "m3u",
        risk: "medium",
      },
      {
        name: "li5bo5 Live/live.m3u",
        url: "https://raw.githubusercontent.com/li5bo5/TVBox/main/Live/live.m3u",
        sourceKind: "manual",
        repo: "li5bo5/TVBox",
        format: "m3u",
        risk: "high",
      },
      {
        name: "Reflyer823 live.txt",
        url: "https://raw.githubusercontent.com/Reflyer823/tvbox-config/master/live.txt",
        sourceKind: "candidate",
        repo: "Reflyer823/tvbox-config",
        format: "diyp_txt",
        risk: "medium",
      },
      {
        name: "Reflyer823 custom_live.txt",
        url: "https://raw.githubusercontent.com/Reflyer823/tvbox-config/master/custom_live.txt",
        sourceKind: "candidate",
        repo: "Reflyer823/tvbox-config",
        format: "diyp_txt",
        risk: "medium",
      },
      {
        name: "WWB521 Live (直连)",
        url: "https://raw.githubusercontent.com/wwb521/live/main/tv.m3u",
        sourceKind: "candidate",
        repo: "wwb521/live",
        format: "m3u",
        risk: "medium",
      },
      {
        name: "qist dianshi / live",
        url: "https://raw.githubusercontent.com/qist/tvbox/master/tv.txt",
        sourceKind: "config",
        sourceConfigName: "qist dianshi",
        sourceConfigUrl: "https://raw.githubusercontent.com/qist/tvbox/master/dianshi.json",
        liveName: "live",
        liveType: 0,
        ua: "okhttp/3.8.1",
      },
      {
        name: "mrgaoshuiquan tvbox.json / 切换直播源(1)",
        url: "https://gh.927223.xyz/https://raw.githubusercontent.com/Kimentanm/aptv/master/m3u/iptv.m3u",
        sourceKind: "config",
        sourceConfigName: "mrgaoshuiquan tvbox.json",
        sourceConfigUrl: "https://raw.githubusercontent.com/mrgaoshuiquan/tvbox-config/main/tvbox.json",
        liveName: "切换直播源(1)",
        liveType: 0,
      },
      {
        name: "mrgaoshuiquan tvbox.json / 切换直播源(2)",
        url: "https://gh.927223.xyz/https://raw.githubusercontent.com/develop202/migu_video/refs/heads/main/interface.txt",
        sourceKind: "config",
        sourceConfigName: "mrgaoshuiquan tvbox.json",
        sourceConfigUrl: "https://raw.githubusercontent.com/mrgaoshuiquan/tvbox-config/main/tvbox.json",
        liveName: "切换直播源(2)",
        liveType: 0,
      },
      {
        name: "mrgaoshuiquan tvbox.json / 范明明（需开启V6网络）",
        url: "https://nos.netease.com/ysf/3d75a78a0fc7ede372c03598d6d10367.m3u",
        sourceKind: "config",
        sourceConfigName: "mrgaoshuiquan tvbox.json",
        sourceConfigUrl: "https://raw.githubusercontent.com/mrgaoshuiquan/tvbox-config/main/tvbox.json",
        liveName: "范明明（需开启V6网络）",
        liveType: 0,
      },
      {
        name: "mrgaoshuiquan tvbox.json / 虎牙一起看",
        url: "https://sub.ottiptv.cc/huyayqk.m3u",
        sourceKind: "config",
        sourceConfigName: "mrgaoshuiquan tvbox.json",
        sourceConfigUrl: "https://raw.githubusercontent.com/mrgaoshuiquan/tvbox-config/main/tvbox.json",
        liveName: "虎牙一起看",
        liveType: 0,
        ua: "okHttp/Mod-1.5.0.0",
      },
      {
        name: "mrgaoshuiquan tvbox.json / 斗鱼一起看",
        url: "https://sub.ottiptv.cc/douyuyqk.m3u",
        sourceKind: "config",
        sourceConfigName: "mrgaoshuiquan tvbox.json",
        sourceConfigUrl: "https://raw.githubusercontent.com/mrgaoshuiquan/tvbox-config/main/tvbox.json",
        liveName: "斗鱼一起看",
        liveType: 0,
        ua: "okHttp/Mod-1.5.0.0",
      },
      {
        name: "mrgaoshuiquan tvbox.json / B站直播",
        url: "https://sub.ottiptv.cc/bililive.m3u",
        sourceKind: "config",
        sourceConfigName: "mrgaoshuiquan tvbox.json",
        sourceConfigUrl: "https://raw.githubusercontent.com/mrgaoshuiquan/tvbox-config/main/tvbox.json",
        liveName: "B站直播",
        liveType: 0,
        ua: "okHttp/Mod-1.5.0.0",
      },
      {
        name: "mrgaoshuiquan tvbox.json / YY轮播",
        url: "https://sub.ottiptv.cc/yylunbo.m3u",
        sourceKind: "config",
        sourceConfigName: "mrgaoshuiquan tvbox.json",
        sourceConfigUrl: "https://raw.githubusercontent.com/mrgaoshuiquan/tvbox-config/main/tvbox.json",
        liveName: "YY轮播",
        liveType: 0,
        ua: "okHttp/Mod-1.5.0.0",
      },
      {
        name: "li5bo5 2026 / 冰茶",
        url: "https://bc.188766.xyz/?ip=&mishitong=true&mima=mianfeibuhuaqian&json=true",
        sourceKind: "config",
        sourceConfigName: "li5bo5 2026",
        sourceConfigUrl: "https://raw.githubusercontent.com/li5bo5/TVBox/main/2026.json",
        liveName: "冰茶",
        liveType: 0,
        ua: "bingcha/1.1(mianfeifenxiang)",
      },
      {
        name: "DXawi classic 0 / 牛播一(新版影视仓/ok影视)",
        url: "http://127.0.0.1:9978/proxy?do=饭太硬&type=liveList",
        sourceKind: "config",
        sourceConfigName: "DXawi classic 0",
        sourceConfigUrl: "https://dxawi.github.io/0/0.json",
        liveName: "牛播一(新版影视仓/ok影视)",
        liveType: 0,
      },
      {
        name: "DXawi classic 0 / IPV4",
        url: "https://ghp.ci/raw.githubusercontent.com/MemoryCollection/IPTV/refs/heads/main/itvlist.txt",
        sourceKind: "config",
        sourceConfigName: "DXawi classic 0",
        sourceConfigUrl: "https://dxawi.github.io/0/0.json",
        liveName: "IPV4",
        liveType: 0,
      },
      {
        name: "DXawi classic 0 / IPV6①",
        url: "https://ghp.ci/raw.githubusercontent.com/fanmingming/live/refs/heads/main/tv/m3u/ipv6.m3u",
        sourceKind: "config",
        sourceConfigName: "DXawi classic 0",
        sourceConfigUrl: "https://dxawi.github.io/0/0.json",
        liveName: "IPV6①",
        liveType: 0,
      },
      {
        name: "DXawi classic 0 / IPV6②",
        url: "https://ghp.ci/raw.githubusercontent.com/wwb521/live/refs/heads/main/tv.m3u",
        sourceKind: "config",
        sourceConfigName: "DXawi classic 0",
        sourceConfigUrl: "https://dxawi.github.io/0/0.json",
        liveName: "IPV6②",
        liveType: 0,
      },
      {
        name: "XYQ TVBox / 本地live文件",
        url: "http://127.0.0.1:9978/file/XYQTVBox/live.txt",
        sourceKind: "config",
        sourceConfigName: "XYQ TVBox",
        sourceConfigUrl: "https://raw.githubusercontent.com/xyq254245/xyqonlinerule/main/XYQTVBox.json",
        liveName: "本地live文件",
      },
      {
        name: "XYQ TVBox / BMCH",
        url: "https://gh.halonice.com/https:/raw.githubusercontent.com/big-mouth-cn/tv/main/iptv-ok.m3u",
        sourceKind: "config",
        sourceConfigName: "XYQ TVBox",
        sourceConfigUrl: "https://raw.githubusercontent.com/xyq254245/xyqonlinerule/main/XYQTVBox.json",
        liveName: "BMCH",
      },
      {
        name: "XYQ TVBox / Tianmu",
        url: "https://ghfile.geekertao.top/https://raw.githubusercontent.com/TianmuTNT/iptv/main/iptv.txt",
        sourceKind: "config",
        sourceConfigName: "XYQ TVBox",
        sourceConfigUrl: "https://raw.githubusercontent.com/xyq254245/xyqonlinerule/main/XYQTVBox.json",
        liveName: "Tianmu",
      },
    ],
  };
}

function ensureDefaultSourceFile(filePath: string): void {
  if (existsSync(filePath)) return;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(defaultSourceCatalog(), null, 2), 'utf8');
}

function defaultStrategyCatalog(): StrategyConfigFile {
  return {
    _comment: '策略配置文件。脚本内只保留 balanced 兜底策略，日常策略请在本文件维护；字段说明见 _schemaNotes。',
    _schemaNotes: {
      defaultStrategy: '默认策略 key；命令行没有传 --st/--strategy 时使用。',
      channelCuration: '频道收口默认配置；defaultPreset 当前可用 none、cn、cn-full、cn-plus。',
      strategies: '策略数组；每个对象代表一个可通过 --st <key> 选择的策略组。',
      key: '策略唯一标识，例如 fast。',
      label: '策略中文名称，用于交互式命令行和策略列表显示。',
      description: '策略说明，用于帮助用户理解用途。',
      enabled: '是否启用；false 时该策略不会出现在可选列表中。',
      filters: '输出过滤条件；status=all/ok/failed，source/group/channel/errorCode 为关键词过滤，minHeight 为最低分辨率高度。',
      sort: '排序配置；entry/entryDir 控制明细排序，report/reportDir 控制报告里的源排序。',
      export: '导出配置；exportAll=false 表示只导出可播放条目，true 表示导出过滤后的全部条目。',
      runtime: '检测运行参数；控制下载超时、检测超时、重试、检测模式、预检、熔断和并发。',
      curation: '频道收口配置；策略组通常不绑定 preset，只配置 keepPerChannel、preFilter 和清晰度兜底等行为。命令行 --preset/--curation-preset 优先级最高。',
      preferredMinHeight: '频道收口优选高度；例如 1080 表示同频道优先选择 1080P 及以上线路。',
      fallbackMinHeight: '频道收口兜底高度；例如 720 表示没有优选线路时可选择 720P 及以上线路。',
      allowLowResFallback: '是否允许低于 fallbackMinHeight 的可播线路作为低清兜底，true 可优先保覆盖。',
    },
    generatedAt: new Date().toISOString(),
    purpose: 'IPTV Picker strategy presets.',
    defaultStrategy: 'balanced',
    strategies: STRATEGIES.map((strategy) => ({
      key: strategy.key,
      label: strategy.label,
      description: strategy.description,
      enabled: strategy.enabled !== false,
      filters: {
        status: strategy.apply.status,
        minHeight: strategy.apply.minHeight,
      },
      sort: {
        entry: strategy.apply.sort,
        entryDir: strategy.apply.sortDir,
        report: strategy.apply.reportSort,
        reportDir: strategy.apply.reportSortDir,
      },
      export: {
        exportAll: strategy.apply.exportAll,
      },
      runtime: {
        downloadTimeoutMs: strategy.apply.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS,
        checkTimeoutMs: strategy.apply.checkTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
        checkRetry: strategy.apply.checkRetry ?? DEFAULT_CHECK_RETRY,
        checkMode: strategy.apply.checkMode ?? DEFAULT_CHECK_MODE,
        preflight: strategy.apply.preflight ?? DEFAULT_PREFLIGHT,
        preflightTimeoutMs: strategy.apply.preflightTimeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS,
        hostTimeoutLimit: strategy.apply.hostTimeoutLimit ?? DEFAULT_HOST_TIMEOUT_LIMIT,
        sourceParallel: strategy.apply.sourceParallel ?? DEFAULT_SOURCE_PARALLEL,
        preflightParallel: strategy.apply.preflightParallel ?? DEFAULT_PREFLIGHT_PARALLEL,
        preflightHostParallel: strategy.apply.preflightHostParallel ?? DEFAULT_PREFLIGHT_HOST_PARALLEL,
        checkParallel: strategy.apply.checkParallel ?? DEFAULT_CHECK_PARALLEL,
        checkHostParallel: strategy.apply.checkHostParallel ?? DEFAULT_CHECK_HOST_PARALLEL,
        pipelineMode: strategy.apply.pipelineMode ?? DEFAULT_PIPELINE_MODE,
      },
      ...(strategy.apply.curationPreset || strategy.apply.curationKeepPerChannel || strategy.apply.curationPreferredMinHeight
        || strategy.apply.curationFallbackMinHeight || strategy.apply.curationAllowLowResFallback != null
        || strategy.apply.curationPreFilter != null ? {
        curation: {
          preset: strategy.apply.curationPreset,
          keepPerChannel: strategy.apply.curationKeepPerChannel,
          preferredMinHeight: strategy.apply.curationPreferredMinHeight,
          fallbackMinHeight: strategy.apply.curationFallbackMinHeight,
          allowLowResFallback: strategy.apply.curationAllowLowResFallback,
          preFilter: strategy.apply.curationPreFilter,
          includeUnmatched: strategy.apply.curationIncludeUnmatched,
          includeFailed: strategy.apply.curationIncludeFailed,
        },
      } : {}),
    })),
    channelCuration: {
      defaultPreset: 'cn',
    },
  };
}

function ensureDefaultStrategyFile(filePath: string): void {
  if (existsSync(filePath)) return;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(defaultStrategyCatalog(), null, 2), 'utf8');
}

function ensureDefaultChannelTargetsFile(filePath: string): void {
  if (existsSync(filePath)) return;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(loadChannelTargets(), null, 2), 'utf8');
}

function ensureDefaultChannelAliasesFile(filePath: string): void {
  if (existsSync(filePath)) return;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(loadChannelAliases(), null, 2), 'utf8');
}

function isStatus(value: unknown): value is CliArgs['status'] {
  return value === 'all' || value === 'ok' || value === 'failed';
}

function isSortKey(value: unknown): value is SortKey {
  return ['default', 'status', 'source', 'group', 'channel', 'resolution', 'bitrate', 'fps', 'error', 'url'].includes(value as string);
}

function isReportSortKey(value: unknown): value is ReportSortKey {
  return ['default', 'source', 'total', 'ok', 'failed', 'ok-rate', 'checked-at'].includes(value as string);
}

function isSortDir(value: unknown): value is 'asc' | 'desc' {
  return value === 'asc' || value === 'desc';
}

function isPositiveIntegerValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isNonNegativeIntegerValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isCheckMode(value: unknown): value is IptvPickerCoreCheckMode {
  return value === 'full' || value === 'fast';
}

function isPipelineMode(value: unknown): value is IptvPickerCorePipelineMode {
  return value === 'source' || value === 'stage';
}

function normalizeStrategyConfigItem(item: StrategyConfigItem): StrategyDefinition | null {
  if (typeof item.key !== 'string' || !item.key.trim()) return null;
  const apply: StrategyDefinition['apply'] = {};
  if (isStatus(item.filters?.status)) apply.status = item.filters.status;
  if (typeof item.filters?.source === 'string') apply.source = item.filters.source;
  if (typeof item.filters?.group === 'string') apply.group = item.filters.group;
  if (typeof item.filters?.channel === 'string') apply.channel = item.filters.channel;
  if (typeof item.filters?.errorCode === 'string') apply.errorCode = item.filters.errorCode;
  if (typeof item.filters?.minHeight === 'number' && isFinite(item.filters.minHeight) && item.filters.minHeight >= 0) {
    apply.minHeight = item.filters.minHeight;
  }
  if (isSortKey(item.sort?.entry)) apply.sort = item.sort.entry;
  if (isSortDir(item.sort?.entryDir)) apply.sortDir = item.sort.entryDir;
  if (isReportSortKey(item.sort?.report)) apply.reportSort = item.sort.report;
  if (isSortDir(item.sort?.reportDir)) apply.reportSortDir = item.sort.reportDir;
  if (typeof item.export?.exportAll === 'boolean') apply.exportAll = item.export.exportAll;
  if (isPositiveIntegerValue(item.runtime?.downloadTimeoutMs)) apply.downloadTimeoutMs = item.runtime.downloadTimeoutMs;
  if (isPositiveIntegerValue(item.runtime?.checkTimeoutMs)) apply.checkTimeoutMs = item.runtime.checkTimeoutMs;
  if (isNonNegativeIntegerValue(item.runtime?.checkRetry)) apply.checkRetry = item.runtime.checkRetry;
  if (isCheckMode(item.runtime?.checkMode)) apply.checkMode = item.runtime.checkMode;
  if (typeof item.runtime?.preflight === 'boolean') apply.preflight = item.runtime.preflight;
  if (isPositiveIntegerValue(item.runtime?.preflightTimeoutMs)) apply.preflightTimeoutMs = item.runtime.preflightTimeoutMs;
  if (isPositiveIntegerValue(item.runtime?.hostTimeoutLimit)) apply.hostTimeoutLimit = item.runtime.hostTimeoutLimit;
  if (isPositiveIntegerValue(item.runtime?.sourceParallel)) apply.sourceParallel = item.runtime.sourceParallel;
  if (isPositiveIntegerValue(item.runtime?.preflightParallel)) apply.preflightParallel = item.runtime.preflightParallel;
  if (isPositiveIntegerValue(item.runtime?.preflightHostParallel)) apply.preflightHostParallel = item.runtime.preflightHostParallel;
  if (isPositiveIntegerValue(item.runtime?.checkParallel)) apply.checkParallel = item.runtime.checkParallel;
  if (isPositiveIntegerValue(item.runtime?.checkHostParallel)) apply.checkHostParallel = item.runtime.checkHostParallel;
  if (isPipelineMode(item.runtime?.pipelineMode)) apply.pipelineMode = item.runtime.pipelineMode;
  if (isCurationPreset(item.curation?.preset)) apply.curationPreset = item.curation.preset;
  if (isPositiveIntegerValue(item.curation?.keepPerChannel)) apply.curationKeepPerChannel = item.curation.keepPerChannel;
  if (isPositiveIntegerValue(item.curation?.preferredMinHeight)) apply.curationPreferredMinHeight = item.curation.preferredMinHeight;
  if (isPositiveIntegerValue(item.curation?.fallbackMinHeight)) apply.curationFallbackMinHeight = item.curation.fallbackMinHeight;
  if (typeof item.curation?.allowLowResFallback === 'boolean') apply.curationAllowLowResFallback = item.curation.allowLowResFallback;
  if (typeof item.curation?.preFilter === 'boolean') apply.curationPreFilter = item.curation.preFilter;
  if (typeof item.curation?.includeUnmatched === 'boolean') apply.curationIncludeUnmatched = item.curation.includeUnmatched;
  if (typeof item.curation?.includeFailed === 'boolean') apply.curationIncludeFailed = item.curation.includeFailed;

  return {
    key: item.key.trim(),
    label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : item.key.trim(),
    description: typeof item.description === 'string' ? item.description.trim() : '',
    enabled: item.enabled !== false,
    apply,
  };
}

function loadStrategies(filePath: string): { strategies: StrategyDefinition[]; defaultStrategy: string; defaultCurationPreset: ChannelCurationPreset } {
  const byKey = new Map<string, StrategyDefinition>();
  for (const strategy of STRATEGIES) byKey.set(strategy.key, strategy);
  let defaultStrategy = 'balanced';
  let defaultCurationPreset: ChannelCurationPreset = 'none';

  if (existsSync(filePath)) {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as StrategyConfigFile;
    if (typeof parsed.defaultStrategy === 'string' && parsed.defaultStrategy.trim()) {
      defaultStrategy = parsed.defaultStrategy.trim();
    }
    if (isCurationPreset(parsed.channelCuration?.defaultPreset)) {
      defaultCurationPreset = parsed.channelCuration.defaultPreset;
    }
    for (const item of parsed.strategies || []) {
      const normalized = normalizeStrategyConfigItem(item);
      if (normalized) byKey.set(normalized.key, normalized);
    }
  }

  const strategies = Array.from(byKey.values()).filter((item) => item.enabled !== false);
  if (!strategies.some((item) => item.key === defaultStrategy)) {
    defaultStrategy = strategies.some((item) => item.key === 'balanced') ? 'balanced' : (strategies[0]?.key || 'custom');
  }

  return {
    strategies,
    defaultStrategy,
    defaultCurationPreset,
  };
}

function usage(): string {
  return [
    'Usage:',
    '  node dist/iptv-picker-cli.js --url <m3u-or-txt-url> [--name <name>] --out <file>',
    '  node dist/iptv-picker-cli.js --input <sources.json> --out <file>',
    '  node dist/iptv-picker-cli.js --interactive',
    '  node dist/iptv-picker-cli.js',
    '',
    'Input / output:',
    '  --url <url>                 check one M3U/TXT/DIYP source URL',
    '  --name <name>               source name for --url',
    `  --input <sources.json>      check multiple sources, default interactive file: ${DEFAULT_INPUT_PATH}`,
    `  --out, -o <file>            JSON output file, default: ${DEFAULT_OUTPUT_PATH}`,
    '  --report-out <file>         deprecated; text report output has been removed',
    '  --source-stats-out <file>   source statistics markdown, default: <out>.source-stats.md',
    '  --channel-stats-out <file>  output channel statistics markdown, default: <out>.channel-stats.md',
    `  --export-live <file>        export playable live playlists for TVBox/影视仓, writes .m3u/.txt/.json siblings, default: ${DEFAULT_LIVE_EXPORT_PATH}`,
    '  --no-export-live            disable live playlist export',
    '  --export-format m3u|txt|json live playlist format hint, default: inferred from file extension or m3u',
    '  --export-all                export all filtered entries instead of only ok=true entries',
    '  --init-default-sources      create the default sources file and exit',
    '  --no-report                 deprecated; text report output has been removed',
    '  --no-md-reports             do not write markdown statistics reports',
    '  --no-progress-output        do not write running partial output files during checks',
    '  --stdout-report             deprecated; text report output has been removed',
    '  --compact                   write compact JSON instead of pretty JSON',
    '  --quiet                     suppress progress logs',
    `  --log                       write runtime logs to default file: ${DEFAULT_LOG_PATH} (enabled by default)`,
    `  --nolog, --no-log           disable runtime log file output`,
    `  --debug                     write debug logs to default file: ${DEFAULT_LOG_PATH}`,
    `  --log-out <file>            write runtime logs to file, default with --log/--debug: ${DEFAULT_LOG_PATH}`,
    `  --download-timeout-ms <n>    source file download timeout, default: ${DEFAULT_DOWNLOAD_TIMEOUT_MS}`,
    `  --check-timeout-ms <n>       per playback URL check timeout, default: ${DEFAULT_CHECK_TIMEOUT_MS}`,
    `  --check-retry <n>            per playback URL retry count, default: ${DEFAULT_CHECK_RETRY}`,
    `  --check-mode <mode>          full|fast, default: ${DEFAULT_CHECK_MODE}`,
    `  --ffprobe-path <file>        use a specific ffprobe binary, or set FFPROBE_PATH`,
    `  --require-ffmpeg             fail when ffprobe is missing instead of falling back to no-ffmpeg mode`,
    `  --preflight                  enable HTTP header preflight before playback checks`,
    `  --no-preflight               disable HTTP header preflight`,
    `  --preflight-timeout-ms <n>   HTTP header preflight timeout, default: ${DEFAULT_PREFLIGHT_TIMEOUT_MS}`,
    `  --host-timeout-limit <n>     block same host after consecutive header timeouts, default: ${DEFAULT_HOST_TIMEOUT_LIMIT}`,
    `  --source-parallel <n>        concurrent live sources, default: ${DEFAULT_SOURCE_PARALLEL}`,
    `  --preflight-parallel <n>     concurrent HTTP header preflight requests, default: ${DEFAULT_PREFLIGHT_PARALLEL}`,
    `  --preflight-host-parallel <n> concurrent HTTP header preflight requests per host, default: ${DEFAULT_PREFLIGHT_HOST_PARALLEL}`,
    `  --check-parallel <n>         concurrent playback URL checks, default: ${DEFAULT_CHECK_PARALLEL}`,
    `  --check-host-parallel <n>    concurrent playback URL checks per host, default: ${DEFAULT_CHECK_HOST_PARALLEL}`,
    `  --pipeline-mode source|stage  source pipeline or global 6-stage pipeline, default: ${DEFAULT_PIPELINE_MODE}`,
    `  --preflight-out <file>        preflight checkpoint file, default: ${DEFAULT_PREFLIGHT_OUTPUT_PATH}`,
    `  --resume, --rp [file]       resume from preflight checkpoint, default file: ${DEFAULT_PREFLIGHT_OUTPUT_PATH}`,
    `  --resume-preflight [file]   same as --resume, kept for compatibility`,
    '  --top-errors <number>       deprecated; text report output has been removed',
    '  --top-sources <number>      deprecated; text report output has been removed',
    '  --st, --strategy <name>     strategy key from config/strategy.json; use --list-strategies to view',
    `  --strategy-file <file>      strategy preset file, default: ${DEFAULT_STRATEGY_PATH}`,
    '  --init-default-strategies   create the default strategy file and exit',
    `  --preset, --curation-preset <name> none|cn|cn-full|cn-plus, default: none`,
    `  --curation-keep <number>    lines kept per matched channel`,
    `  --curation-preferred-height <number> preferred curation height, e.g. 1080`,
    `  --curation-fallback-height <number> fallback curation height, e.g. 720`,
    `  --low-res-fallback          allow lower-than-fallback playable lines as coverage fallback`,
    `  --no-low-res-fallback       drop lower-than-fallback lines during curation`,
    `  --curation-pre-filter       filter unmatched channels before URL checking`,
    `  --no-curation-pre-filter    disable pre-check curation filtering`,
    `  --curation-include-unmatched keep unmatched channels after curation`,
    `  --curation-include-failed   allow failed matched channels in curation output`,
    `  --curation-targets-file <file>  channel target config, default: ${DEFAULT_CHANNEL_TARGETS_PATH}`,
    `  --curation-aliases-file <file>  channel alias config, default: ${DEFAULT_CHANNEL_ALIASES_PATH}`,
    `  sync                         short command: upload existing files under ${DEFAULT_PUBLISH_DIR}/ using publish sync config`,
    `  --publish-sync-file <file>   publish sync config, default: ${DEFAULT_PUBLISH_SYNC_CONFIG_PATH}`,
    `  --publish-sync-only          upload existing files under ${DEFAULT_PUBLISH_DIR}/ using publish sync config`,
    `  --no-publish-sync            disable WebDAV/HTTP POST/GET publish sync`,
    '  --init-default-channel-targets create the default channel target file and exit',
    '  --init-default-channel-aliases create the default channel alias file and exit',
    '  --list-strategies           list available strategy presets and exit',
    '',
    'Interactive:',
    '  --interactive, -i          start guided prompts',
    '  no arguments               start guided prompts when stdin is interactive',
    '',
    'Filters:',
    '  --status all|ok|failed      default: all',
    '  --source <keyword>          match source name or source URL',
    '  --group <keyword>           match group name',
    '  --channel <keyword>         match channel name',
    '  --error-code <code>         match exact errorCode',
    '  --min-height <number>       keep entries with resolution height >= number',
    '',
    'Sorting:',
    '  --sort default|status|source|group|channel|resolution|bitrate|fps|error|url',
    '  --sort-dir asc|desc         default: asc',
    '  default order: ok first, source, group, channel, high resolution, url',
    '',
    'Report sorting:',
    '  --report-sort default|source|total|ok|failed|ok-rate|checked-at',
    '  --report-sort-dir asc|desc  default: desc',
    '  default report order: high ok rate, ok count, total count, source',
    '',
    'Strategies:',
    '  Use --st <name> or --strategy <name>. Interactive mode also asks you to choose one.',
    `  Strategy presets are loaded from ${DEFAULT_STRATEGY_PATH}.`,
    '  The script only includes one built-in fallback strategy: balanced.',
    '  Use --list-strategies to view the strategies currently enabled by the config file.',
    '  custom                      自定义参数: manually configure filters and sorting',
    '',
    'Curation:',
    '  none                        不做频道收口，只保留过滤后的条目',
    '  cn                          央视/卫视频道匹配规则集合',
    '',
    'Strategy examples:',
    '  node dist/iptv-picker-cli.js --st hd',
    '  node dist/iptv-picker-cli.js --strategy audit',
    '  node dist/iptv-picker-cli.js --st balanced --input data/source.json --export-live res/iptv.m3u',
    '',
    'sources.json formats:',
    '  [{"name":"source","url":"https://example.com/live.m3u"}]',
    '  {"sources":[{"name":"source","url":"https://example.com/live.m3u"}]}',
    '',
    `default sources file: ${DEFAULT_INPUT_PATH}`,
    '  if the default file does not exist, the CLI will create it with open-source IPTV sources',
    `default output: ${DEFAULT_OUTPUT_PATH}, report: ${deriveReportPath(DEFAULT_OUTPUT_PATH)}, markdown reports: ${deriveSourceStatsReportPath(DEFAULT_OUTPUT_PATH)}, ${deriveChannelStatsReportPath(DEFAULT_OUTPUT_PATH)}, live exports: res/iptv.m3u, res/iptv.txt, res/iptv.json`,
    `publish: when curation matches all targets, copy live exports to ${DEFAULT_PUBLISH_DIR}/; logs, reports, and ${DEFAULT_OUTPUT_PATH} are not copied`,
  ].join('\n');
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    out: DEFAULT_OUTPUT_PATH,
    exportFormat: 'm3u',
    exportLive: DEFAULT_LIVE_EXPORT_PATH,
    exportAll: false,
    noReport: false,
    noMdReports: false,
    noProgressOutput: false,
    stdoutReport: false,
    compact: false,
    quiet: false,
    log: true,
    noLog: false,
    debug: false,
    downloadTimeoutMs: DEFAULT_DOWNLOAD_TIMEOUT_MS,
    checkTimeoutMs: DEFAULT_CHECK_TIMEOUT_MS,
    checkRetry: DEFAULT_CHECK_RETRY,
    checkMode: DEFAULT_CHECK_MODE,
    requireFfmpeg: false,
    preflight: DEFAULT_PREFLIGHT,
    preflightTimeoutMs: DEFAULT_PREFLIGHT_TIMEOUT_MS,
    hostTimeoutLimit: DEFAULT_HOST_TIMEOUT_LIMIT,
    sourceParallel: DEFAULT_SOURCE_PARALLEL,
    preflightParallel: DEFAULT_PREFLIGHT_PARALLEL,
    preflightHostParallel: DEFAULT_PREFLIGHT_HOST_PARALLEL,
    checkParallel: DEFAULT_CHECK_PARALLEL,
    checkHostParallel: DEFAULT_CHECK_HOST_PARALLEL,
    pipelineMode: DEFAULT_PIPELINE_MODE,
    preflightOut: DEFAULT_PREFLIGHT_OUTPUT_PATH,
    runtimeCliOverrides: {},
    curationCliOverrides: {},
    topErrors: 10,
    topSources: 20,
    status: 'all',
    sort: 'default',
    sortDir: 'asc',
    reportSort: 'default',
    reportSortDir: 'desc',
    strategyFile: DEFAULT_STRATEGY_PATH,
    curationPreset: 'none',
    curationPreferredMinHeight: 1080,
    curationFallbackMinHeight: 720,
    curationAllowLowResFallback: true,
    curationPreFilter: false,
    curationIncludeUnmatched: false,
    curationIncludeFailed: false,
    curationTargetsFile: DEFAULT_CHANNEL_TARGETS_PATH,
    curationAliasesFile: DEFAULT_CHANNEL_ALIASES_PATH,
    publishSyncConfigFile: process.env.PUBLISH_SYNC_CONFIG_FILE || DEFAULT_PUBLISH_SYNC_CONFIG_PATH,
    noPublishSync: false,
    publishSyncOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item === 'sync' || item === 'publish-sync') args.publishSyncOnly = true;
    else if (item === '--help' || item === '-h') args.help = true;
    else if (item === '--init-default-sources') args.initDefaultSources = true;
    else if (item === '--interactive' || item === '-i') args.interactive = true;
    else if (item === '--url') args.url = argv[++i];
    else if (item === '--name') args.name = argv[++i];
    else if (item === '--input') args.input = argv[++i];
    else if (item === '--out' || item === '-o') args.out = argv[++i];
    else if (item === '--report-out' || item === '--txt-report') args.reportOut = argv[++i];
    else if (item === '--source-stats-out') args.sourceStatsOut = argv[++i];
    else if (item === '--channel-stats-out') args.channelStatsOut = argv[++i];
    else if (item === '--export-live') args.exportLive = argv[++i];
    else if (item === '--no-export-live') args.exportLive = undefined;
    else if (item === '--export-format') args.exportFormat = parseLiveExportFormat(argv[++i]);
    else if (item === '--export-all') args.exportAll = true;
    else if (item === '--no-report') args.noReport = true;
    else if (item === '--no-md-reports') args.noMdReports = true;
    else if (item === '--no-progress-output') args.noProgressOutput = true;
    else if (item === '--stdout-report') args.stdoutReport = true;
    else if (item === '--compact') args.compact = true;
    else if (item === '--quiet' || item === '-q') args.quiet = true;
    else if (item === '--log') args.log = true;
    else if (item === '--nolog' || item === '--no-log') {
      args.log = false;
      args.noLog = true;
    }
    else if (item === '--debug') args.debug = true;
    else if (item === '--log-out') args.logOut = argv[++i];
    else if (item === '--download-timeout-ms') {
      args.downloadTimeoutMs = parsePositiveInteger(argv[++i], '--download-timeout-ms');
      args.runtimeCliOverrides = { ...args.runtimeCliOverrides, downloadTimeoutMs: true };
    } else if (item === '--check-timeout-ms') {
      args.checkTimeoutMs = parsePositiveInteger(argv[++i], '--check-timeout-ms');
      args.runtimeCliOverrides = { ...args.runtimeCliOverrides, checkTimeoutMs: true };
    } else if (item === '--check-retry') {
      args.checkRetry = parseNonNegativeInteger(argv[++i], '--check-retry');
      args.runtimeCliOverrides = { ...args.runtimeCliOverrides, checkRetry: true };
    } else if (item === '--check-mode') {
      args.checkMode = parseCheckMode(argv[++i]);
      args.runtimeCliOverrides = { ...args.runtimeCliOverrides, checkMode: true };
    } else if (item === '--require-ffmpeg') {
      args.requireFfmpeg = true;
      args.runtimeCliOverrides = { ...args.runtimeCliOverrides, requireFfmpeg: true };
    } else if (item === '--ffprobe-path') {
      args.ffprobePath = argv[++i];
      args.runtimeCliOverrides = { ...args.runtimeCliOverrides, ffprobePath: true };
    } else if (item === '--preflight') {
      args.preflight = true;
      args.runtimeCliOverrides = { ...args.runtimeCliOverrides, preflight: true };
    } else if (item === '--no-preflight') {
      args.preflight = false;
      args.runtimeCliOverrides = { ...args.runtimeCliOverrides, preflight: true };
    } else if (item === '--preflight-timeout-ms') {
      args.preflightTimeoutMs = parsePositiveInteger(argv[++i], '--preflight-timeout-ms');
      args.runtimeCliOverrides = { ...args.runtimeCliOverrides, preflightTimeoutMs: true };
    } else if (item === '--host-timeout-limit') {
      args.hostTimeoutLimit = parsePositiveInteger(argv[++i], '--host-timeout-limit');
      args.runtimeCliOverrides = { ...args.runtimeCliOverrides, hostTimeoutLimit: true };
    } else if (item === '--source-parallel') {
      args.sourceParallel = parsePositiveInteger(argv[++i], '--source-parallel');
      args.runtimeCliOverrides = { ...args.runtimeCliOverrides, sourceParallel: true };
    } else if (item === '--preflight-parallel') {
      args.preflightParallel = parsePositiveInteger(argv[++i], '--preflight-parallel');
      args.runtimeCliOverrides = { ...args.runtimeCliOverrides, preflightParallel: true };
    } else if (item === '--preflight-host-parallel') {
      args.preflightHostParallel = parsePositiveInteger(argv[++i], '--preflight-host-parallel');
      args.runtimeCliOverrides = { ...args.runtimeCliOverrides, preflightHostParallel: true };
    } else if (item === '--check-parallel') {
      args.checkParallel = parsePositiveInteger(argv[++i], '--check-parallel');
      args.runtimeCliOverrides = { ...args.runtimeCliOverrides, checkParallel: true };
    } else if (item === '--check-host-parallel') {
      args.checkHostParallel = parsePositiveInteger(argv[++i], '--check-host-parallel');
      args.runtimeCliOverrides = { ...args.runtimeCliOverrides, checkHostParallel: true };
    } else if (item === '--pipeline-mode') {
      args.pipelineMode = parsePipelineMode(argv[++i]);
      args.runtimeCliOverrides = { ...args.runtimeCliOverrides, pipelineMode: true };
    } else if (item === '--preflight-out') {
      args.preflightOut = argv[++i];
    } else if (item === '--resume-preflight' || item === '--resume' || item === '--rp') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args.resumePreflight = next;
        i++;
      } else {
        args.resumePreflight = DEFAULT_PREFLIGHT_OUTPUT_PATH;
      }
    }
    else if (item === '--top-errors') args.topErrors = parsePositiveInteger(argv[++i], '--top-errors');
    else if (item === '--top-sources') args.topSources = parsePositiveInteger(argv[++i], '--top-sources');
    else if (item === '--strategy' || item === '--st') args.strategy = parseStrategy(argv[++i]);
    else if (item === '--strategy-file') args.strategyFile = argv[++i];
    else if (item === '--init-default-strategies') args.initDefaultStrategies = true;
    else if (item === '--init-default-channel-targets') args.initDefaultChannelTargets = true;
    else if (item === '--init-default-channel-aliases') args.initDefaultChannelAliases = true;
    else if (item === '--list-strategies') args.listStrategies = true;
    else if (item === '--curation-preset' || item === '--preset') {
      args.curationPreset = parseCurationPreset(argv[++i]);
      args.curationCliOverrides = { ...args.curationCliOverrides, preset: true };
    }
    else if (item === '--curation-keep') {
      args.curationKeepPerChannel = parsePositiveInteger(argv[++i], '--curation-keep');
      args.curationCliOverrides = { ...args.curationCliOverrides, keepPerChannel: true };
    }
    else if (item === '--curation-preferred-height') {
      args.curationPreferredMinHeight = parsePositiveInteger(argv[++i], '--curation-preferred-height');
      args.curationCliOverrides = { ...args.curationCliOverrides, preferredMinHeight: true };
    }
    else if (item === '--curation-fallback-height') {
      args.curationFallbackMinHeight = parsePositiveInteger(argv[++i], '--curation-fallback-height');
      args.curationCliOverrides = { ...args.curationCliOverrides, fallbackMinHeight: true };
    }
    else if (item === '--low-res-fallback') {
      args.curationAllowLowResFallback = true;
      args.curationCliOverrides = { ...args.curationCliOverrides, allowLowResFallback: true };
    }
    else if (item === '--no-low-res-fallback') {
      args.curationAllowLowResFallback = false;
      args.curationCliOverrides = { ...args.curationCliOverrides, allowLowResFallback: true };
    }
    else if (item === '--curation-pre-filter') {
      args.curationPreFilter = true;
      args.runtimeCliOverrides = { ...args.runtimeCliOverrides, curationPreFilter: true };
      args.curationCliOverrides = { ...args.curationCliOverrides, preFilter: true };
    } else if (item === '--no-curation-pre-filter') {
      args.curationPreFilter = false;
      args.runtimeCliOverrides = { ...args.runtimeCliOverrides, curationPreFilter: true };
      args.curationCliOverrides = { ...args.curationCliOverrides, preFilter: true };
    }
    else if (item === '--curation-include-unmatched') {
      args.curationIncludeUnmatched = true;
      args.curationCliOverrides = { ...args.curationCliOverrides, includeUnmatched: true };
    }
    else if (item === '--curation-include-failed') {
      args.curationIncludeFailed = true;
      args.curationCliOverrides = { ...args.curationCliOverrides, includeFailed: true };
    }
    else if (item === '--curation-targets-file') args.curationTargetsFile = argv[++i];
    else if (item === '--curation-aliases-file') args.curationAliasesFile = argv[++i];
    else if (item === '--publish-sync-file') args.publishSyncConfigFile = argv[++i];
    else if (item === '--publish-sync-only') args.publishSyncOnly = true;
    else if (item === '--no-publish-sync') args.noPublishSync = true;
    else if (item === '--status') args.status = parseStatus(argv[++i]);
    else if (item === '--source') args.source = argv[++i];
    else if (item === '--group') args.group = argv[++i];
    else if (item === '--channel') args.channel = argv[++i];
    else if (item === '--error-code') args.errorCode = argv[++i];
    else if (item === '--min-height') args.minHeight = parsePositiveNumber(argv[++i], '--min-height');
    else if (item === '--sort') args.sort = parseSort(argv[++i]);
    else if (item === '--sort-dir') args.sortDir = parseSortDir(argv[++i]);
    else if (item === '--report-sort') args.reportSort = parseReportSort(argv[++i]);
    else if (item === '--report-sort-dir') args.reportSortDir = parseSortDir(argv[++i]);
    else throw new Error(`Unknown argument: ${item}`);
  }
  return args;
}

function strategyByKey(strategies: StrategyDefinition[], key: StrategyKey | undefined): StrategyDefinition | undefined {
  return strategies.find((item) => item.key === key);
}

function parseStrategy(value: string | undefined): StrategyKey {
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new Error('--strategy requires a non-empty strategy name');
}

function parseCurationPreset(value: string | undefined): ChannelCurationPreset {
  if (value === 'none' || value === 'cn' || value === 'cn-full' || value === 'cn-plus') return value;
  throw new Error('--curation-preset must be none, cn, cn-full or cn-plus');
}

function applyStrategy(args: CliArgs, strategies: StrategyDefinition[]): CliArgs {
  if (!args.strategy || args.strategy === 'custom') return args;
  const strategy = strategyByKey(strategies, args.strategy);
  if (!strategy) {
    throw new Error(`Unknown strategy: ${args.strategy}. Use --list-strategies to see available presets.`);
  }
  const applied = { ...args, ...strategy.apply, strategy: args.strategy };
  if (args.runtimeCliOverrides?.downloadTimeoutMs) applied.downloadTimeoutMs = args.downloadTimeoutMs;
  if (args.runtimeCliOverrides?.checkTimeoutMs) applied.checkTimeoutMs = args.checkTimeoutMs;
  if (args.runtimeCliOverrides?.checkRetry) applied.checkRetry = args.checkRetry;
  if (args.runtimeCliOverrides?.checkMode) applied.checkMode = args.checkMode;
  if (args.runtimeCliOverrides?.preflight) applied.preflight = args.preflight;
  if (args.runtimeCliOverrides?.preflightTimeoutMs) applied.preflightTimeoutMs = args.preflightTimeoutMs;
  if (args.runtimeCliOverrides?.hostTimeoutLimit) applied.hostTimeoutLimit = args.hostTimeoutLimit;
  if (args.runtimeCliOverrides?.sourceParallel) applied.sourceParallel = args.sourceParallel;
  if (args.runtimeCliOverrides?.preflightParallel) applied.preflightParallel = args.preflightParallel;
  if (args.runtimeCliOverrides?.preflightHostParallel) applied.preflightHostParallel = args.preflightHostParallel;
  if (args.runtimeCliOverrides?.checkParallel) applied.checkParallel = args.checkParallel;
  if (args.runtimeCliOverrides?.checkHostParallel) applied.checkHostParallel = args.checkHostParallel;
  if (args.runtimeCliOverrides?.pipelineMode) applied.pipelineMode = args.pipelineMode;
  if (args.runtimeCliOverrides?.curationPreFilter) applied.curationPreFilter = args.curationPreFilter;
  if (args.curationCliOverrides?.preset) applied.curationPreset = args.curationPreset;
  if (args.curationCliOverrides?.keepPerChannel) applied.curationKeepPerChannel = args.curationKeepPerChannel;
  if (args.curationCliOverrides?.preferredMinHeight) applied.curationPreferredMinHeight = args.curationPreferredMinHeight;
  if (args.curationCliOverrides?.fallbackMinHeight) applied.curationFallbackMinHeight = args.curationFallbackMinHeight;
  if (args.curationCliOverrides?.allowLowResFallback) applied.curationAllowLowResFallback = args.curationAllowLowResFallback;
  if (args.curationCliOverrides?.preFilter) applied.curationPreFilter = args.curationPreFilter;
  if (args.curationCliOverrides?.includeUnmatched) applied.curationIncludeUnmatched = args.curationIncludeUnmatched;
  if (args.curationCliOverrides?.includeFailed) applied.curationIncludeFailed = args.curationIncludeFailed;
  applied.runtimeCliOverrides = args.runtimeCliOverrides;
  applied.curationCliOverrides = args.curationCliOverrides;
  return applied;
}

function strategyLabel(key: StrategyKey | undefined, strategies: StrategyDefinition[] = STRATEGIES): string {
  if (!key) return '-';
  if (key === 'custom') return '自定义参数';
  const strategy = strategyByKey(strategies, key);
  return strategy ? `${strategy.label} (${strategy.key})` : key;
}

function curationLabel(key: ChannelCurationPreset): string {
  if (key === 'none') return '-';
  return key;
}

function curationSummaryLabel(key: ChannelCurationPreset): string {
  if (key === 'none') return '不收口';
  if (key === 'cn') return '央视卫视频道';
  if (key === 'cn-full') return '央视卫视+地方特色';
  if (key === 'cn-plus') return '央视卫视+地方特色+港澳台';
  return key;
}

function printStrategies(strategies: StrategyDefinition[], defaultStrategy: string, filePath: string): void {
  console.log(`Strategy file: ${filePath}`);
  console.log(`Default strategy: ${defaultStrategy}`);
  console.log('');
  for (const strategy of strategies) {
    console.log(`${strategy.key.padEnd(12)} ${strategy.label}  ${strategy.description}`);
  }
}

async function promptCliArgs(
  args: CliArgs,
  strategies: StrategyDefinition[],
  defaultStrategy: string,
  defaultCurationPreset: ChannelCurationPreset,
): Promise<CliArgs> {
  console.log('');
  console.log('External IPTV quality check wizard');
  console.log('Use arrow keys to choose. Press Enter to confirm.');
  console.log('');

  let next = { ...args };
  if (!next.url && !next.input) {
    const mode = await promptChoice('选择检测模式', [
      ['url', '单个直播源 URL'],
      ['input', '批量 sources.json 文件'],
    ], 'url');
    if (mode === 'input') {
      next.input = await promptRequired('sources.json 路径', DEFAULT_INPUT_PATH);
    } else {
      next.url = await promptRequired('直播源 URL');
    }
  }

  if (next.url) {
    next.name = await promptOptional('源名称', next.name || 'source') || undefined;
  }
  if (next.input) {
    next.input = await promptRequired('sources.json 路径', next.input || DEFAULT_INPUT_PATH);
    ensureDefaultSourceFile(resolve(next.input));
  }

  const strategyChoices: Array<[StrategyKey, string]> = [
    ...strategies.map((item) => [item.key, `${item.label}：${item.description}`] as [StrategyKey, string]),
    ['custom', '自定义参数：手动配置过滤、排序、报告排序'],
  ];
  next.strategy = await promptChoice('选择优选策略', strategyChoices, next.strategy || defaultStrategy);
  next = applyStrategy(next, strategies);

  if (next.strategy === 'custom' || next.curationPreset === 'none') {
    next.curationPreset = await promptChoice('选择频道收口', [
      ['none', '不收口，仅保留过滤后的条目'],
      ['cn', '央视卫视频道：匹配 CCTV、教育台和省级卫视'],
      ['cn-full', '央视卫视扩展：增加大陆地方特色频道'],
      ['cn-plus', '央视卫视港澳台：增加大陆地方特色和港澳台频道'],
    ], next.curationPreset || defaultCurationPreset);
  }
  if (next.curationPreset !== 'none') {
    next.curationKeepPerChannel = await promptInteger('每个匹配频道保留线路数', next.curationKeepPerChannel || 1, 1);
    next.curationPreferredMinHeight = await promptInteger('高清优选高度', next.curationPreferredMinHeight || 1080, 1);
    next.curationFallbackMinHeight = await promptInteger('清晰兜底高度', next.curationFallbackMinHeight || 720, 1);
    next.curationAllowLowResFallback = await promptYesNo('是否允许低清线路兜底保覆盖', next.curationAllowLowResFallback);
    next.curationPreFilter = await promptYesNo('是否检测前跳过未匹配频道', next.curationPreFilter);
    next.curationIncludeUnmatched = await promptYesNo('是否在收口结果中保留未匹配频道', next.curationIncludeUnmatched);
    next.curationIncludeFailed = await promptYesNo('是否允许失败的匹配频道进入收口候选', next.curationIncludeFailed);
  }

  next.out = await promptRequired('输出 JSON 文件', next.out);
  const writeLive = await promptYesNo('是否导出可直接使用的直播源文件', !!next.exportLive);
  if (writeLive) {
    next.exportLive = await promptRequired('直播源输出文件名前缀或任一格式文件', next.exportLive || DEFAULT_LIVE_EXPORT_PATH);
    next.exportFormat = inferLiveExportFormat(next.exportLive, next.exportFormat);
    next.exportAll = await promptYesNo('是否导出过滤后的全部条目（默认仅可用）', next.exportAll);
  } else {
    next.exportLive = undefined;
  }
  next.noReport = true;
  next.reportOut = undefined;
  next.stdoutReport = false;
  const configureRuntime = await promptYesNo('是否调整检测超时、重试和并发参数', false);
  if (configureRuntime) {
    next.pipelineMode = await promptChoice('流水线模式', [
      ['stage', '阶段式：所有直播源完成当前阶段后再进入下一阶段'],
      ['source', '源流水线：每个直播源独立完成下载、解析、预检、检测'],
    ], next.pipelineMode);
    next.checkMode = await promptChoice('检测模式', [
      ['full', '完整检测：iptv-checker + ffprobe，输出分辨率/码率/帧率等信息'],
      ['fast', '快速检测：轻量 ffprobe，只确认 URL 能探测到媒体流'],
    ], next.checkMode);
    next.preflight = await promptYesNo('是否启用 HTTP header 预检', next.preflight);
    if (next.preflight) {
      next.preflightTimeoutMs = await promptInteger('HTTP header 预检超时毫秒', next.preflightTimeoutMs, 1);
      next.hostTimeoutLimit = await promptInteger('同 host 连续超时屏蔽阈值', next.hostTimeoutLimit, 1);
    }
    next.downloadTimeoutMs = await promptInteger('源文件下载超时毫秒', next.downloadTimeoutMs, 1);
    next.checkTimeoutMs = await promptInteger('单条直播 URL 检测超时毫秒', next.checkTimeoutMs, 1);
    next.checkRetry = await promptInteger('单条直播 URL 重试次数', next.checkRetry, 0);
    next.sourceParallel = await promptInteger('直播源并发数量', next.sourceParallel, 1);
    next.preflightParallel = await promptInteger('HTTP header 预检并发数量', next.preflightParallel, 1);
    next.preflightHostParallel = await promptInteger('同 host HTTP header 预检并发数量', next.preflightHostParallel, 1);
    next.checkParallel = await promptInteger('播放 URL 检测并发数量', next.checkParallel, 1);
    next.checkHostParallel = await promptInteger('同 host 播放 URL 检测并发数量', next.checkHostParallel, 1);
  }

  if (next.strategy === 'custom') {
    const configureFilters = await promptYesNo('是否配置输出过滤条件', false);
    if (configureFilters) {
      next.status = await promptChoice('状态过滤', [
        ['all', '全部'],
        ['ok', '仅可用'],
        ['failed', '仅失败'],
      ], next.status);
      next.source = await promptOptional('源名称/URL 关键词，留空不过滤', next.source) || undefined;
      next.group = await promptOptional('分组关键词，留空不过滤', next.group) || undefined;
      next.channel = await promptOptional('频道关键词，留空不过滤', next.channel) || undefined;
      next.errorCode = await promptOptional('错误码，留空不过滤', next.errorCode) || undefined;
      next.minHeight = await promptOptionalNumber('最低分辨率高度，例如 720，留空不过滤', next.minHeight);
    }

    const configureSorting = await promptYesNo('是否配置排序', false);
    if (configureSorting) {
      next.sort = await promptChoice('URL 明细排序字段', [
        ['default', '默认：可用优先、源、分组、频道、分辨率高优先、URL'],
        ['status', '状态'],
        ['source', '源'],
        ['group', '分组'],
        ['channel', '频道'],
        ['resolution', '分辨率'],
        ['bitrate', '码率'],
        ['fps', '帧率'],
        ['error', '错误码'],
        ['url', 'URL'],
      ], next.sort);
      if (next.sort !== 'default') {
        next.sortDir = await promptChoice('URL 明细排序方向', [
          ['asc', '升序'],
          ['desc', '降序'],
        ], next.sortDir);
      }
      next.reportSort = await promptChoice('源级统计排序字段', [
        ['default', '默认：可用率、可用数、总数、源名称'],
        ['source', '源'],
        ['total', '总 URL 数'],
        ['ok', '可用数'],
        ['failed', '失败数'],
        ['ok-rate', '可用率'],
        ['checked-at', '最近检测时间'],
      ], next.reportSort);
      if (next.reportSort !== 'default') {
        next.reportSortDir = await promptChoice('源级统计排序方向', [
          ['asc', '升序'],
          ['desc', '降序'],
        ], next.reportSortDir);
      }
    }
  }

  console.log('');
  console.log('即将执行：');
  console.log(`  source: ${next.input ? `input=${next.input}` : `url=${next.url}`}`);
  console.log(`  strategy: ${strategyLabel(next.strategy, strategies)}`);
  console.log(`  curation: ${curationSummaryLabel(next.curationPreset)}`);
  console.log(`  curation options: keep=${next.curationKeepPerChannel ?? '-'}, preferredHeight=${next.curationPreferredMinHeight ?? '-'}, fallbackHeight=${next.curationFallbackMinHeight ?? '-'}, lowResFallback=${next.curationAllowLowResFallback}, preFilter=${next.curationPreFilter}, includeUnmatched=${next.curationIncludeUnmatched}, includeFailed=${next.curationIncludeFailed}`);
  console.log(`  out: ${next.out}`);
  console.log(`  live export: ${next.exportLive ? `${liveExportBasePath(next.exportLive)}.{m3u,txt,json} (${next.exportAll ? 'all filtered entries' : 'ok only'})` : '-'}`);
  console.log('  report: -');
  console.log(`  markdown: ${next.noMdReports ? '-' : `${next.sourceStatsOut || deriveSourceStatsReportPath(next.out)}, ${next.channelStatsOut || deriveChannelStatsReportPath(next.out)}`}`);
  console.log(`  filters: status=${next.status}, source=${next.source || '-'}, group=${next.group || '-'}, channel=${next.channel || '-'}, errorCode=${next.errorCode || '-'}, minHeight=${next.minHeight ?? '-'}`);
  console.log(`  runtime: pipelineMode=${next.pipelineMode}, checkMode=${next.checkMode}, ffprobePath=${next.ffprobePath || process.env.FFPROBE_PATH || '-'}, requireFfmpeg=${next.requireFfmpeg}, preflight=${next.preflight}, preflightTimeoutMs=${next.preflightTimeoutMs}, hostTimeoutLimit=${next.hostTimeoutLimit}, downloadTimeoutMs=${next.downloadTimeoutMs}, checkTimeoutMs=${next.checkTimeoutMs}, checkRetry=${next.checkRetry}, sourceParallel=${next.sourceParallel}, preflightParallel=${next.preflightParallel}, preflightHostParallel=${next.preflightHostParallel}, checkParallel=${next.checkParallel}, checkHostParallel=${next.checkHostParallel}, preflightOut=${next.preflightOut}, resumePreflight=${next.resumePreflight || '-'}`);
  console.log(`  entry sort: ${next.sort} ${next.sort === 'default' ? '(fixed)' : next.sortDir}`);
  console.log(`  report sort: ${next.reportSort} ${next.reportSort === 'default' ? '(fixed)' : next.reportSortDir}`);
  console.log('');

  const confirmed = await promptYesNo('确认开始检测', true);
  if (!confirmed) throw new Error('Cancelled by user.');
  return next;
}

async function promptRequired(
  label: string,
  defaultValue?: string,
): Promise<string> {
  const { input: promptInput } = await loadInquirerPrompts();
  return promptInput({
    message: label,
    default: defaultValue,
    validate: (value) => value.trim() ? true : '该项不能为空。',
  });
}

async function promptOptional(
  label: string,
  defaultValue?: string,
): Promise<string> {
  const { input: promptInput } = await loadInquirerPrompts();
  return promptInput({
    message: label,
    default: defaultValue,
  });
}

async function promptOptionalNumber(
  label: string,
  defaultValue?: number,
): Promise<number | undefined> {
  const { input: promptInput } = await loadInquirerPrompts();
  const raw = await promptInput({
    message: label,
    default: defaultValue == null ? undefined : String(defaultValue),
    validate: (value) => {
      if (!value.trim()) return true;
      const n = Number(value);
      return isFinite(n) && n >= 0 ? true : '请输入非负数字，或留空跳过。';
    },
  });
  if (!raw.trim()) return undefined;
  return Number(raw);
}

async function promptInteger(
  label: string,
  defaultValue: number,
  minValue: number,
): Promise<number> {
  const { input: promptInput } = await loadInquirerPrompts();
  const raw = await promptInput({
    message: label,
    default: String(defaultValue),
    validate: (value) => {
      const n = Number(value);
      return Number.isInteger(n) && n >= minValue ? true : `请输入大于等于 ${minValue} 的整数。`;
    },
  });
  return Number(raw);
}

async function promptYesNo(
  label: string,
  defaultValue: boolean,
): Promise<boolean> {
  const { confirm } = await loadInquirerPrompts();
  return confirm({
    message: label,
    default: defaultValue,
  });
}

async function promptChoice<T extends string>(
  label: string,
  choices: Array<[T, string]>,
  defaultValue: T,
): Promise<T> {
  const { select } = await loadInquirerPrompts();
  return select({
    message: label,
    choices: choices.map(([value, description]) => ({
      name: value,
      value,
      description,
    })),
    default: defaultValue,
  });
}

function parseStatus(value: string | undefined): CliArgs['status'] {
  if (value === 'all' || value === 'ok' || value === 'failed') return value;
  throw new Error('--status must be all, ok, or failed');
}

function parseSort(value: string | undefined): SortKey {
  const allowed: SortKey[] = ['default', 'status', 'source', 'group', 'channel', 'resolution', 'bitrate', 'fps', 'error', 'url'];
  if (allowed.includes(value as SortKey)) return value as SortKey;
  throw new Error('--sort must be default, status, source, group, channel, resolution, bitrate, fps, error, or url');
}

function parseReportSort(value: string | undefined): ReportSortKey {
  const allowed: ReportSortKey[] = ['default', 'source', 'total', 'ok', 'failed', 'ok-rate', 'checked-at'];
  if (allowed.includes(value as ReportSortKey)) return value as ReportSortKey;
  throw new Error('--report-sort must be default, source, total, ok, failed, ok-rate, or checked-at');
}

function parseSortDir(value: string | undefined): CliArgs['sortDir'] {
  if (value === 'asc' || value === 'desc') return value;
  throw new Error('--sort-dir must be asc or desc');
}

function parseLiveExportFormat(value: string | undefined): LiveExportFormat {
  if (value === 'm3u' || value === 'txt' || value === 'json') return value;
  throw new Error('--export-format must be m3u, txt or json');
}

function parsePositiveNumber(value: string | undefined, name: string): number {
  const n = Number(value);
  if (!isFinite(n) || n < 0) throw new Error(`${name} must be a positive number`);
  return n;
}

function parsePositiveInteger(value: string | undefined, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
  return n;
}

function parseNonNegativeInteger(value: string | undefined, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

function parseCheckMode(value: string | undefined): IptvPickerCoreCheckMode {
  if (value === 'full' || value === 'fast') return value;
  throw new Error('--check-mode must be full or fast');
}

function parsePipelineMode(value: string | undefined): IptvPickerCorePipelineMode {
  if (value === 'source' || value === 'stage') return value;
  throw new Error('--pipeline-mode must be source or stage');
}

function loadSources(args: CliArgs): SourceLoadResult {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  if (args.input) {
    const file = resolve(args.input);
    if (file === DEFAULT_INPUT_PATH) ensureDefaultSourceFile(file);
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const raw = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.sources)
        ? parsed.sources
        : Array.isArray(parsed.liveSources)
          ? parsed.liveSources
          : [];
    const sources = raw
      .map((item: { name?: unknown; url?: unknown; content?: unknown; sourceKind?: unknown; enabled?: unknown }) => ({
        name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : String(item.url || 'source'),
        url: typeof item.url === 'string' ? item.url.trim() : '',
        content: typeof item.content === 'string' ? item.content : undefined,
        sourceKind: item.sourceKind === 'candidate' || item.sourceKind === 'manual' || item.sourceKind === 'config'
          ? item.sourceKind
          : 'custom' as const,
        enabled: item.enabled !== false,
      }))
      .filter((source: IptvPickerCoreInputSource & { enabled?: boolean }) => !!source.url && source.enabled !== false)
      .map(({ enabled: _enabled, ...source }: IptvPickerCoreInputSource & { enabled?: boolean }) => source);
    return {
      sources,
      rawSourceCount: raw.length,
      droppedSourceCount: raw.length - sources.length,
      inputMode: 'input',
      inputFile: file,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
    };
  }

  if (!args.url) {
    return {
      sources: [],
      rawSourceCount: 0,
      droppedSourceCount: 0,
      inputMode: 'url',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
    };
  }
  const url = args.url.trim();
  const sources: IptvPickerCoreInputSource[] = url
    ? [{
      name: args.name?.trim() || url,
      url,
      sourceKind: 'custom',
    }]
    : [];
  return {
    sources,
    rawSourceCount: 1,
    droppedSourceCount: sources.length === 0 ? 1 : 0,
    inputMode: 'url',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
  };
}

function includesText(value: string | undefined, keyword: string | undefined): boolean {
  if (!keyword) return true;
  return (value || '').toLowerCase().includes(keyword.toLowerCase());
}

function resolutionHeight(entry: IptvPickerCoreChannelEntry): number {
  const match = (entry.resolution || '').match(/\d+\s*x\s*(\d+)/i);
  return match ? Number(match[1]) || 0 : 0;
}

function filterEntries(entries: IptvPickerCoreChannelEntry[], args: CliArgs): IptvPickerCoreChannelEntry[] {
  return entries.filter((entry) => {
    if (args.status === 'ok' && !entry.ok) return false;
    if (args.status === 'failed' && entry.ok) return false;
    if (args.source && !includesText(`${entry.sourceName || ''} ${entry.sourceUrl || ''}`, args.source)) return false;
    if (args.group && !includesText(entry.group, args.group)) return false;
    if (args.channel && !includesText(entry.channel, args.channel)) return false;
    if (args.errorCode && entry.errorCode !== args.errorCode) return false;
    if (args.minHeight != null && resolutionHeight(entry) < args.minHeight) return false;
    return true;
  });
}

function str(value: unknown): string {
  return String(value || '').toLowerCase();
}

function num(value: unknown): number {
  const n = Number(value);
  return isFinite(n) ? n : -1;
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'zh-CN');
}

function sortValue(entry: IptvPickerCoreChannelEntry, key: SortKey): string | number {
  if (key === 'status') return entry.ok ? 0 : 1;
  if (key === 'source') return str(entry.sourceName || entry.sourceUrl);
  if (key === 'group') return str(entry.group);
  if (key === 'channel') return str(entry.channel);
  if (key === 'resolution') return resolutionHeight(entry);
  if (key === 'bitrate') return num(entry.bitrate);
  if (key === 'fps') return num(entry.fps);
  if (key === 'error') return str(entry.errorCode);
  if (key === 'url') return str(entry.bareUrl);
  return 0;
}

function defaultCompare(a: IptvPickerCoreChannelEntry, b: IptvPickerCoreChannelEntry): number {
  return (
    Number(b.ok) - Number(a.ok) ||
    str(a.sourceName || a.sourceUrl).localeCompare(str(b.sourceName || b.sourceUrl), 'zh-CN') ||
    str(a.group).localeCompare(str(b.group), 'zh-CN') ||
    str(a.channel).localeCompare(str(b.channel), 'zh-CN') ||
    resolutionHeight(b) - resolutionHeight(a) ||
    str(a.bareUrl).localeCompare(str(b.bareUrl), 'zh-CN')
  );
}

function sortEntries(entries: IptvPickerCoreChannelEntry[], args: CliArgs): IptvPickerCoreChannelEntry[] {
  const sorted = entries.slice();
  sorted.sort((a, b) => {
    const base = args.sort === 'default'
      ? defaultCompare(a, b)
      : compareValues(sortValue(a, args.sort), sortValue(b, args.sort)) || defaultCompare(a, b);
    return args.sortDir === 'desc' && args.sort !== 'default' ? -base : base;
  });
  return sorted;
}

function okRate(source: IptvPickerCoreSourceSummary): number {
  return source.totalUrls > 0 ? source.okUrls / source.totalUrls : 0;
}

function reportSortValue(source: IptvPickerCoreSourceSummary, key: ReportSortKey): string | number {
  if (key === 'source') return str(source.sourceName || source.sourceUrl);
  if (key === 'total') return source.totalUrls;
  if (key === 'ok') return source.okUrls;
  if (key === 'failed') return source.failedUrls;
  if (key === 'ok-rate') return okRate(source);
  if (key === 'checked-at') return source.checkedAt ? Date.parse(source.checkedAt) || 0 : 0;
  return 0;
}

function defaultReportCompare(a: IptvPickerCoreSourceSummary, b: IptvPickerCoreSourceSummary): number {
  return (
    okRate(b) - okRate(a) ||
    b.okUrls - a.okUrls ||
    b.totalUrls - a.totalUrls ||
    str(a.sourceName || a.sourceUrl).localeCompare(str(b.sourceName || b.sourceUrl), 'zh-CN')
  );
}

function sortReport(report: IptvPickerCoreReport, args: CliArgs): IptvPickerCoreReport {
  const sources = report.sources.slice();
  sources.sort((a, b) => {
    const base = args.reportSort === 'default'
      ? defaultReportCompare(a, b)
      : compareValues(reportSortValue(a, args.reportSort), reportSortValue(b, args.reportSort)) || defaultReportCompare(a, b);
    return args.reportSortDir === 'desc' && args.reportSort !== 'default' ? -base : base;
  });
  return { ...report, sources };
}

function deriveReportPath(outPath: string): string {
  const ext = extname(outPath);
  if (!ext) return `${outPath}.report.txt`;
  return `${outPath.slice(0, -ext.length)}.report.txt`;
}

function deriveSourceStatsReportPath(outPath: string): string {
  const ext = extname(outPath);
  if (!ext) return `${outPath}.source-stats.md`;
  return `${outPath.slice(0, -ext.length)}.source-stats.md`;
}

function deriveChannelStatsReportPath(outPath: string): string {
  const ext = extname(outPath);
  if (!ext) return `${outPath}.channel-stats.md`;
  return `${outPath.slice(0, -ext.length)}.channel-stats.md`;
}

function deriveRunningPath(filePath: string): string {
  const ext = extname(filePath);
  if (!ext) return `${filePath}.running`;
  return `${filePath.slice(0, -ext.length)}.running${ext}`;
}

function inferLiveExportFormat(filePath: string | undefined, fallback: LiveExportFormat): LiveExportFormat {
  const ext = extname(filePath || '').toLowerCase();
  if (ext === '.txt') return 'txt';
  if (ext === '.json') return 'json';
  if (ext === '.m3u' || ext === '.m3u8') return 'm3u';
  return fallback;
}

function liveExportBasePath(filePath: string): string {
  const ext = extname(filePath);
  if (['.m3u', '.m3u8', '.txt', '.json'].includes(ext.toLowerCase())) {
    return filePath.slice(0, -ext.length);
  }
  return filePath;
}

function deriveLiveExportFiles(filePath: string): Array<{ file: string; format: LiveExportFormat }> {
  const base = liveExportBasePath(filePath);
  return [
    { file: `${base}.m3u`, format: 'm3u' },
    { file: `${base}.txt`, format: 'txt' },
    { file: `${base}.json`, format: 'json' },
  ];
}

function avoidLiveExportPathConflict(filePath: string, format: LiveExportFormat, usedPaths: Set<string>): string {
  const ext = format === 'm3u' ? '.m3u' : `.${format}`;
  const base = liveExportBasePath(filePath);
  let candidate = filePath;
  let index = 0;
  while (usedPaths.has(candidate.toLowerCase())) {
    candidate = `${base}.iptv${index > 0 ? `-${index + 1}` : ''}${ext}`;
    index++;
  }
  usedPaths.add(candidate.toLowerCase());
  return candidate;
}

function sanitizeLiveText(value: string | undefined, fallback: string): string {
  const text = String(value || '').replace(/[\r\n]+/g, ' ').trim();
  return text || fallback;
}

function escapeM3uAttribute(value: string): string {
  return value.replace(/"/g, '&quot;');
}

function resultNoFfmpegMode(result: IptvPickerCoreFileResult): boolean {
  return result.runtime?.noFfmpegMode === true || result.entries.some((entry) => entry.engine === 'no-ffmpeg' || entry.probeMode === 'no-ffmpeg');
}

function noFfmpegNotice(): string {
  return 'no-ffmpeg: ffprobe not found, playback quality was not verified.';
}

function exportEntriesToM3u(entries: IptvPickerCoreChannelEntry[], noFfmpegMode = false): string {
  const lines = ['#EXTM3U'];
  if (noFfmpegMode) lines.push(`# ${noFfmpegNotice()}`);
  for (const entry of entries) {
    const channel = sanitizeLiveText(entry.channel, '未命名');
    const group = sanitizeLiveText(entry.group || entry.sourceName, '其他');
    lines.push(`#EXTINF:-1 group-title="${escapeM3uAttribute(group)}",${channel}`);
    lines.push(entry.bareUrl);
  }
  return `${lines.join('\n')}\n`;
}

function exportEntriesToTxt(entries: IptvPickerCoreChannelEntry[], noFfmpegMode = false): string {
  const groups = new Map<string, IptvPickerCoreChannelEntry[]>();
  for (const entry of entries) {
    const group = sanitizeLiveText(entry.group || entry.sourceName, '其他');
    const list = groups.get(group) || [];
    list.push(entry);
    groups.set(group, list);
  }

  const lines: string[] = [];
  if (noFfmpegMode) lines.push(`# ${noFfmpegNotice()}`);
  for (const [group, list] of groups) {
    lines.push(`${group},#genre#`);
    for (const entry of list) {
      lines.push(`${sanitizeLiveText(entry.channel, '未命名')},${entry.bareUrl}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function exportEntriesToJson(entries: IptvPickerCoreChannelEntry[], noFfmpegMode = false): string {
  return `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    format: 'iptv-json',
    probeMode: noFfmpegMode ? 'no-ffmpeg' : 'ffmpeg',
    noFfmpegMode,
    probeWarning: noFfmpegMode ? noFfmpegNotice() : undefined,
    entries: entries.map((entry) => ({
      group: sanitizeLiveText(entry.group || entry.sourceName, '其他'),
      channel: sanitizeLiveText(entry.channel, '未命名'),
      url: entry.bareUrl,
      engine: entry.engine,
      probeMode: entry.probeMode || (entry.engine === 'no-ffmpeg' ? 'no-ffmpeg' : 'ffmpeg'),
      probeWarning: entry.probeWarning,
      sourceName: entry.sourceName,
      sourceUrl: entry.sourceUrl,
      resolution: entry.resolution,
      bitrate: entry.bitrate,
      fps: entry.fps,
      checkedAt: entry.checkedAt,
    })),
  }, null, 2)}\n`;
}

function buildLiveExport(result: IptvPickerCoreFileResult, args: CliArgs): {
  format: LiveExportFormat;
  entries: IptvPickerCoreChannelEntry[];
  content: string;
} {
  const format = inferLiveExportFormat(args.exportLive, args.exportFormat);
  const entries = result.entries.filter((entry) => args.exportAll || entry.ok);
  const noFfmpegMode = resultNoFfmpegMode(result);
  const content = format === 'txt'
    ? exportEntriesToTxt(entries, noFfmpegMode)
    : format === 'json'
      ? exportEntriesToJson(entries, noFfmpegMode)
      : exportEntriesToM3u(entries, noFfmpegMode);
  return { format, entries, content };
}

function buildLiveExports(result: IptvPickerCoreFileResult, args: CliArgs): Array<{
  file: string;
  format: LiveExportFormat;
  entries: IptvPickerCoreChannelEntry[];
  content: string;
}> {
  if (!args.exportLive) return [];
  const usedPaths = new Set<string>([resolve(args.out).toLowerCase()]);
  return deriveLiveExportFiles(args.exportLive).map((item) => {
    const file = avoidLiveExportPathConflict(resolve(item.file), item.format, usedPaths);
    const exportArgs = { ...args, exportLive: item.file, exportFormat: item.format };
    return {
      file,
      ...buildLiveExport(result, exportArgs),
    };
  });
}

interface PublishArtifact {
  type: 'json' | 'live';
  source: string;
  target: string;
}

function shouldPublishOutput(result: IptvPickerCoreFileResult, args: CliArgs): boolean {
  const curation = result.output?.channelCuration;
  return args.curationPreset !== 'none'
    && !!curation
    && curation.targets > 0
    && curation.missingTargets === 0;
}

function buildPublishArtifacts(
  liveExports: Array<{ file: string }>,
  publishDir = DEFAULT_PUBLISH_DIR,
): PublishArtifact[] {
  const targetDir = resolve(publishDir);
  const seen = new Set<string>();
  const items: PublishArtifact[] = [];
  const push = (type: PublishArtifact['type'], source: string) => {
    const resolvedSource = resolve(source);
    const target = resolve(targetDir, basename(resolvedSource));
    const key = resolvedSource.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ type, source: resolvedSource, target });
  };

  for (const liveExport of liveExports) push('live', liveExport.file);
  return items;
}

function publishMatchedOutput(
  liveExports: Array<{ file: string }>,
): PublishArtifact[] {
  const artifacts = buildPublishArtifacts(liveExports);
  if (artifacts.length === 0) return artifacts;
  mkdirSync(resolve(DEFAULT_PUBLISH_DIR), { recursive: true });
  for (const item of artifacts) {
    if (item.source === item.target) continue;
    copyFileSync(item.source, item.target);
  }
  return artifacts;
}

function buildPublishDirArtifacts(publishDir = DEFAULT_PUBLISH_DIR): PublishArtifact[] {
  const targetDir = resolve(publishDir);
  if (!existsSync(targetDir)) return [];
  return readdirSync(targetDir, { withFileTypes: true })
    .filter((item) => item.isFile())
    .map((item) => {
      const file = resolve(targetDir, item.name);
      return {
        type: 'live' as const,
        source: file,
        target: file,
      };
    });
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(text)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(text)) return false;
  }
  return fallback;
}

function asPositiveNumber(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringFromEnv(name: unknown): string | undefined {
  const key = asString(name);
  return key ? asString(process.env[key]) : undefined;
}

function resolveConfigString(value: unknown, envName: unknown): string | undefined {
  return stringFromEnv(envName) || asString(value);
}

function resolveConfigUrl(value: unknown, envName: unknown): string | undefined {
  const envValue = stringFromEnv(envName);
  if (envValue) return envValue;
  const direct = asString(value);
  if (direct) return direct;
  const envText = asString(envName);
  return envText && /^https?:\/\//i.test(envText) ? envText : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!key) continue;
    if (item == null) continue;
    result[key] = String(item);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function asStringList(value: unknown): string[] | undefined {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const normalized = items
    .map((item) => String(item).trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function envStringList(name: string): string[] | undefined {
  return asStringList(process.env[name]);
}

function normalizeRemotePublishTarget(item: RemotePublishTargetConfig, index: number): RemotePublishResolvedTarget | undefined {
  const type = asString(item.type) as RemotePublishTargetType | undefined;
  if (type !== 'webdav' && type !== 'http-post' && type !== 'http-get') return undefined;
  const target: RemotePublishResolvedTarget = {
    type,
    name: asString(item.name) || `${type}-${index + 1}`,
    enabled: asBoolean(item.enabled, true),
    files: asStringList(item.files),
    timeoutMs: item.timeoutMs == null ? undefined : asPositiveNumber(item.timeoutMs, 0),
    headers: asStringRecord(item.headers),
  };
  if (type === 'webdav') {
    target.baseUrl = resolveConfigUrl(item.baseUrl, item.baseUrlEnv);
    target.username = resolveConfigString(item.username, item.usernameEnv);
    target.password = resolveConfigString(item.password, item.passwordEnv);
    target.remoteDir = asString(item.remoteDir) || '';
  } else if (type === 'http-post') {
    const mode = asString(item.mode) as RemotePostMode | undefined;
    target.url = resolveConfigUrl(item.url, item.urlEnv);
    target.token = resolveConfigString(item.token, item.tokenEnv);
    target.authHeader = asString(item.authHeader) || 'Authorization';
    target.mode = mode === 'json' || mode === 'binary' ? mode : 'multipart';
    target.fields = asStringRecord(item.fields);
    target.remoteDir = asString(item.remoteDir) || '';
    target.pathParam = asString(item.pathParam) || 'path';
    target.contentType = asString(item.contentType);
  } else {
    target.url = resolveConfigUrl(item.url, item.urlEnv);
    target.token = resolveConfigString(item.token, item.tokenEnv);
    target.authHeader = asString(item.authHeader) || 'Authorization';
    target.fields = asStringRecord(item.fields);
  }
  return target;
}

function loadRemotePublishConfigFile(filePath: string): { exists: boolean; config?: RemotePublishConfigFile } {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) return { exists: false };
  const parsed = JSON.parse(readFileSync(resolved, 'utf8')) as RemotePublishConfigFile;
  return { exists: true, config: parsed };
}

function loadEnvRemoteTargets(): RemotePublishResolvedTarget[] {
  const targets: RemotePublishResolvedTarget[] = [];
  const webdavUrl = asString(process.env.PUBLISH_WEBDAV_URL);
  if (webdavUrl) {
    targets.push({
      type: 'webdav',
      name: asString(process.env.PUBLISH_WEBDAV_NAME) || 'env-webdav',
      enabled: asBoolean(process.env.PUBLISH_WEBDAV_ENABLED, true),
      files: envStringList('PUBLISH_WEBDAV_FILES'),
      timeoutMs: asPositiveNumber(process.env.PUBLISH_WEBDAV_TIMEOUT_MS, 0) || undefined,
      baseUrl: webdavUrl,
      username: asString(process.env.PUBLISH_WEBDAV_USERNAME),
      password: asString(process.env.PUBLISH_WEBDAV_PASSWORD),
      remoteDir: asString(process.env.PUBLISH_WEBDAV_REMOTE_DIR) || '',
    });
  }
  const postUrl = asString(process.env.PUBLISH_POST_URL);
  if (postUrl) {
    const mode = asString(process.env.PUBLISH_POST_MODE) as RemotePostMode | undefined;
    targets.push({
      type: 'http-post',
      name: asString(process.env.PUBLISH_POST_NAME) || 'env-http-post',
      enabled: asBoolean(process.env.PUBLISH_POST_ENABLED, true),
      files: envStringList('PUBLISH_POST_FILES'),
      timeoutMs: asPositiveNumber(process.env.PUBLISH_POST_TIMEOUT_MS, 0) || undefined,
      url: postUrl,
      token: asString(process.env.PUBLISH_POST_TOKEN),
      authHeader: asString(process.env.PUBLISH_POST_AUTH_HEADER) || 'Authorization',
      mode: mode === 'json' || mode === 'binary' ? mode : 'multipart',
      fields: asStringRecord({
        source: process.env.PUBLISH_POST_FIELD_SOURCE,
        tag: process.env.PUBLISH_POST_FIELD_TAG,
      }),
      remoteDir: asString(process.env.PUBLISH_POST_REMOTE_DIR) || '',
      pathParam: asString(process.env.PUBLISH_POST_PATH_PARAM) || 'path',
      contentType: asString(process.env.PUBLISH_POST_CONTENT_TYPE),
    });
  }
  const getUrl = asString(process.env.PUBLISH_GET_URL);
  if (getUrl) {
    targets.push({
      type: 'http-get',
      name: asString(process.env.PUBLISH_GET_NAME) || 'env-http-get',
      enabled: asBoolean(process.env.PUBLISH_GET_ENABLED, true),
      files: envStringList('PUBLISH_GET_FILES'),
      timeoutMs: asPositiveNumber(process.env.PUBLISH_GET_TIMEOUT_MS, 0) || undefined,
      url: getUrl,
      token: asString(process.env.PUBLISH_GET_TOKEN),
      authHeader: asString(process.env.PUBLISH_GET_AUTH_HEADER) || 'Authorization',
      fields: asStringRecord({
        source: process.env.PUBLISH_GET_FIELD_SOURCE,
        tag: process.env.PUBLISH_GET_FIELD_TAG,
      }),
    });
  }
  return targets;
}

function loadRemotePublishConfig(args: CliArgs): RemotePublishResolvedConfig | undefined {
  if (args.noPublishSync) return undefined;
  const file = loadRemotePublishConfigFile(args.publishSyncConfigFile);
  const fileConfig = file.config;
  const fileTargets = (Array.isArray(fileConfig?.targets) ? fileConfig.targets : [])
    .map((item, index) => normalizeRemotePublishTarget(item, index))
    .filter((item): item is RemotePublishResolvedTarget => !!item);
  const envTargets = loadEnvRemoteTargets();
  const targets = [...fileTargets, ...envTargets].filter((item) => item.enabled);
  const enabledFallback = file.exists || envTargets.length > 0;
  const enabled = asBoolean(process.env.PUBLISH_REMOTE_ENABLED, asBoolean(fileConfig?.enabled, enabledFallback));
  if (!enabled || targets.length === 0) return undefined;
  return {
    enabled,
    failOnRemoteError: asBoolean(
      process.env.PUBLISH_REMOTE_FAIL_ON_ERROR,
      asBoolean(fileConfig?.failOnRemoteError, true),
    ),
    timeoutMs: asPositiveNumber(process.env.PUBLISH_REMOTE_TIMEOUT_MS, asPositiveNumber(fileConfig?.timeoutMs, 30000)),
    targets,
  };
}

function selectPublishArtifacts(
  artifacts: PublishArtifact[],
  target: RemotePublishResolvedTarget,
): PublishArtifact[] {
  if (!target.files?.length) return artifacts;
  const wanted = new Set(target.files.map((item) => basename(item).toLowerCase()));
  return artifacts.filter((item) => wanted.has(basename(item.target).toLowerCase()));
}

function remoteHeaders(target: RemotePublishResolvedTarget): Record<string, string> {
  const headers = { ...(target.headers || {}) };
  if (target.type === 'webdav' && target.username && target.password) {
    headers.Authorization = `Basic ${Buffer.from(`${target.username}:${target.password}`).toString('base64')}`;
  }
  if ((target.type === 'http-post' || target.type === 'http-get') && target.token && target.authHeader) {
    headers[target.authHeader] = `Bearer ${target.token}`;
  }
  return headers;
}

function joinRemoteUrl(baseUrl: string, ...segments: string[]): string {
  const suffix = segments
    .flatMap((segment) => segment.split('/'))
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return suffix ? `${baseUrl.replace(/\/+$/, '')}/${suffix}` : baseUrl;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function ensureWebDavDir(target: RemotePublishResolvedTarget, headers: Record<string, string>, timeoutMs: number): Promise<void> {
  if (!target.baseUrl || !target.remoteDir) return;
  const parts = target.remoteDir.split('/').map((item) => item.trim()).filter(Boolean);
  const current: string[] = [];
  for (const part of parts) {
    current.push(part);
    const res = await fetchWithTimeout(joinRemoteUrl(target.baseUrl, ...current), { method: 'MKCOL', headers }, timeoutMs);
    if (![200, 201, 204, 301, 302, 405].includes(res.status)) {
      throw new Error(`MKCOL ${current.join('/')} failed with HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }
}

function contentTypeForFile(file: string): string {
  const ext = extname(file).toLowerCase();
  if (ext === '.m3u' || ext === '.m3u8') return 'application/vnd.apple.mpegurl; charset=utf-8';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

async function publishWebDavTarget(
  target: RemotePublishResolvedTarget,
  artifacts: PublishArtifact[],
  timeoutMs: number,
): Promise<void> {
  if (!target.baseUrl) throw new Error('missing WebDAV baseUrl or PUBLISH_WEBDAV_URL');
  const headers = remoteHeaders(target);
  await ensureWebDavDir(target, headers, timeoutMs);
  for (const artifact of artifacts) {
    const fileName = basename(artifact.target);
    const url = joinRemoteUrl(target.baseUrl, target.remoteDir || '', fileName);
    const body = readFileSync(artifact.target);
    const res = await fetchWithTimeout(url, {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': contentTypeForFile(fileName),
      },
      body,
    }, timeoutMs);
    if (![200, 201, 204].includes(res.status)) {
      throw new Error(`PUT ${fileName} failed with HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }
}

async function publishHttpPostTarget(
  target: RemotePublishResolvedTarget,
  artifacts: PublishArtifact[],
  timeoutMs: number,
): Promise<number> {
  if (!target.url) throw new Error('missing POST url or PUBLISH_POST_URL');
  const headers = remoteHeaders(target);
  if (target.mode === 'binary') {
    let lastStatus = 0;
    for (const artifact of artifacts) {
      const fileName = basename(artifact.target);
      const url = withBinaryUploadPath(target.url, target, artifact);
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': target.contentType || contentTypeForFile(fileName),
        },
        body: readFileSync(artifact.target),
      }, timeoutMs);
      lastStatus = res.status;
      if (!res.ok) {
        throw new Error(`POST binary ${fileName} failed with HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
    }
    return lastStatus;
  }
  if (target.mode === 'json') {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    const body = JSON.stringify({
      fields: target.fields || {},
      files: artifacts.map((artifact) => {
        const fileName = basename(artifact.target);
        return {
          name: fileName,
          contentType: contentTypeForFile(fileName),
          contentBase64: readFileSync(artifact.target).toString('base64'),
        };
      }),
    });
    const res = await fetchWithTimeout(target.url, {
      method: 'POST',
      headers,
      body,
    }, timeoutMs);
    if (!res.ok) {
      throw new Error(`POST failed with HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    return res.status;
  }

  let lastStatus = 0;
  for (const artifact of artifacts) {
    const fileName = basename(artifact.target);
    const form = new FormData();
    for (const [key, value] of Object.entries(target.fields || {})) form.append(key, value);
    form.append('files', new Blob([readFileSync(artifact.target)], { type: contentTypeForFile(fileName) }), fileName);
    const res = await fetchWithTimeout(target.url, {
      method: 'POST',
      headers,
      body: form,
    }, timeoutMs);
    lastStatus = res.status;
    if (!res.ok) {
      throw new Error(`POST multipart ${fileName} failed with HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }
  return lastStatus;
}

function joinRemotePath(...segments: string[]): string {
  return segments
    .flatMap((segment) => segment.split('/'))
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
}

function withBinaryUploadPath(url: string, target: RemotePublishResolvedTarget, artifact: PublishArtifact): string {
  const next = new URL(url);
  for (const [key, value] of Object.entries(target.fields || {})) {
    next.searchParams.set(key, value);
  }
  next.searchParams.set(target.pathParam || 'path', joinRemotePath(target.remoteDir || '', basename(artifact.target)));
  return next.toString();
}

function withQueryFields(url: string, fields: Record<string, string> | undefined, artifacts: PublishArtifact[]): string {
  const next = new URL(url);
  for (const [key, value] of Object.entries(fields || {})) {
    next.searchParams.set(key, value);
  }
  if (artifacts.length > 0 && !next.searchParams.has('files')) {
    next.searchParams.set('files', artifacts.map((artifact) => basename(artifact.target)).join(','));
  }
  return next.toString();
}

async function publishHttpGetTarget(
  target: RemotePublishResolvedTarget,
  artifacts: PublishArtifact[],
  timeoutMs: number,
): Promise<number> {
  if (!target.url) throw new Error('missing GET url or PUBLISH_GET_URL');
  const res = await fetchWithTimeout(withQueryFields(target.url, target.fields, artifacts), {
    method: 'GET',
    headers: remoteHeaders(target),
  }, timeoutMs);
  if (!res.ok) {
    throw new Error(`GET failed with HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.status;
}

async function publishRemoteArtifacts(
  artifacts: PublishArtifact[],
  config: RemotePublishResolvedConfig | undefined,
  onLog?: (line: string) => void,
): Promise<RemotePublishResult[]> {
  if (!config || artifacts.length === 0) return [];
  const results: RemotePublishResult[] = [];
  for (const target of config.targets) {
    const selected = selectPublishArtifacts(artifacts, target);
    if (selected.length === 0) continue;
    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    let status: number | undefined;
    let error: string | undefined;
    onLog?.(`[remote-publish:start] [type:${target.type}] [name:${target.name}] [files:${selected.length}] [target:${target.type === 'webdav' ? target.baseUrl || '-' : target.url || '-'}]`);
    try {
      const timeoutMs = target.timeoutMs || config.timeoutMs;
      if (target.type === 'webdav') await publishWebDavTarget(target, selected, timeoutMs);
      else if (target.type === 'http-post') status = await publishHttpPostTarget(target, selected, timeoutMs);
      else status = await publishHttpGetTarget(target, selected, timeoutMs);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const finishedAt = new Date().toISOString();
    results.push({
      type: target.type,
      name: target.name,
      ok: !error,
      files: selected.length,
      status,
      target: target.type === 'webdav' ? target.baseUrl : target.url,
      startedAt,
      finishedAt,
      durationMs: Date.now() - startedMs,
      error,
    });
    const latest = results[results.length - 1];
    if (latest.ok) {
      onLog?.(`[remote-publish:success] [type:${latest.type}] [name:${latest.name}] [files:${latest.files}] [duration:${formatDurationMs(latest.durationMs)}]${latest.status ? ` [status:${latest.status}]` : ''}`);
    } else {
      onLog?.(`[remote-publish:failed] [type:${latest.type}] [name:${latest.name}] [files:${latest.files}] [duration:${formatDurationMs(latest.durationMs)}] [error:${latest.error || '-'}]`);
    }
  }
  return results;
}

async function runPublishSyncOnly(args: CliArgs): Promise<void> {
  const remotePublishConfig = loadRemotePublishConfig(args);
  if (!remotePublishConfig) {
    throw new Error(`Publish sync config is disabled or empty. Check ${resolve(args.publishSyncConfigFile)}.`);
  }
  const artifacts = buildPublishDirArtifacts();
  if (artifacts.length === 0) {
    throw new Error(`No files found under ${resolve(DEFAULT_PUBLISH_DIR)}.`);
  }
  if (!args.quiet) {
    cliLog(`[publish-sync] [dir:${resolve(DEFAULT_PUBLISH_DIR)}] [files:${artifacts.length}] [config:${resolve(args.publishSyncConfigFile)}]`);
  }
  const results = await publishRemoteArtifacts(artifacts, remotePublishConfig, (line) => {
    if (!args.quiet) cliLog(line);
    else writeRuntimeLog(`${logTimestamp()} ${line}`);
  });
  for (const item of results) {
    if (!args.quiet) {
      cliLog(`[remote-publish:${item.type}] [name:${item.name}] [files:${item.files}] [ok:${item.ok}]${item.status ? ` [status:${item.status}]` : ''}${item.error ? ` [error:${item.error}]` : ''}`);
    }
  }
  flushRuntimeLog();
  if (remotePublishConfig.failOnRemoteError && results.some((item) => !item.ok)) {
    throw new Error('Remote publish failed. Check runtime log for details.');
  }
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

function step(
  name: string,
  inputCount: number,
  outputCount: number,
  timing?: { startedAt?: string; finishedAt?: string; durationMs?: number },
  note?: string,
): NonNullable<IptvPickerCoreFileResult['pipeline']>['steps'][number] {
  const lost = Math.max(0, inputCount - outputCount);
  return {
    name,
    input: inputCount,
    output: outputCount,
    lost,
    lossRate: pct(lost, inputCount),
    startedAt: timing?.startedAt,
    finishedAt: timing?.finishedAt,
    durationMs: timing?.durationMs,
    note,
  };
}

function countBy<T>(items: T[], keyFn: (item: T) => string | undefined): Array<{ code: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts, ([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code, 'zh-CN'));
}

function buildPipeline(
  rawResult: IptvPickerCoreFileResult,
  outputEntries: IptvPickerCoreChannelEntry[],
  sourceLoad: SourceLoadResult,
  outputTiming: { startedAt: string; finishedAt: string; durationMs: number },
): NonNullable<IptvPickerCoreFileResult['pipeline']> {
  const rawEntries = rawResult.entries.length;
  const okEntries = rawResult.entries.filter((entry) => entry.ok).length;
  const failedEntries = rawEntries - okEntries;
  const sourceDownloadFailures = new Set(rawResult.entries
    .filter((entry) => entry.errorCode === 'SOURCE_DOWNLOAD_FAILED')
    .map((entry) => entry.sourceUrl || entry.bareUrl));
  const lintFailures = new Set(rawResult.entries
    .filter((entry) => entry.errorCode === 'LINT_FAILED')
    .map((entry) => entry.sourceUrl || entry.bareUrl));
  const engineTiming = rawResult.timing;
  const engineWindow = engineTiming
    ? { startedAt: engineTiming.startedAt, finishedAt: engineTiming.finishedAt, durationMs: engineTiming.durationMs }
    : undefined;
  return {
    inputMode: sourceLoad.inputMode,
    inputFile: sourceLoad.inputFile,
    rawSources: sourceLoad.rawSourceCount,
    loadedSources: sourceLoad.sources.length,
    droppedSources: sourceLoad.droppedSourceCount,
    checkedSources: rawResult.status.checkedSources,
    rawEntries,
    okEntries,
    failedEntries,
    outputEntries: outputEntries.length,
    steps: [
      step(
        '加载输入源',
        sourceLoad.rawSourceCount,
        sourceLoad.sources.length,
        { startedAt: sourceLoad.startedAt, finishedAt: sourceLoad.finishedAt, durationMs: sourceLoad.durationMs },
        '跳过禁用或没有 URL 的输入行',
      ),
      step(
        '下载源文件',
        sourceLoad.sources.length,
        Math.max(0, sourceLoad.sources.length - sourceDownloadFailures.size),
        engineTiming ? { ...engineWindow, durationMs: engineTiming.totals.downloadMs } : engineWindow,
        `${sourceDownloadFailures.size} 个源下载失败；耗时为逐源下载耗时汇总`,
      ),
      step(
        '解析播放列表',
        Math.max(0, sourceLoad.sources.length - sourceDownloadFailures.size),
        Math.max(0, sourceLoad.sources.length - sourceDownloadFailures.size),
        engineTiming ? { ...engineWindow, durationMs: engineTiming.totals.parseMs } : engineWindow,
        'M3U 轻解析，或 TXT/DIYP 解析并转换为临时 M3U',
      ),
      step(
        'M3U 格式预检',
        Math.max(0, sourceLoad.sources.length - sourceDownloadFailures.size),
        Math.max(0, sourceLoad.sources.length - lintFailures.size),
        engineTiming ? { ...engineWindow, durationMs: engineTiming.totals.lintMs } : engineWindow,
        `${lintFailures.size} 个源存在 M3U 格式错误；TXT/DIYP 会跳过 linter`,
      ),
      step(
        '播放质量检测',
        rawEntries,
        okEntries,
        engineTiming ? { ...engineWindow, durationMs: engineTiming.totals.checkMs } : engineWindow,
        `${failedEntries} 条 URL 检测失败；耗时为逐源 iptv-checker 耗时汇总`,
      ),
      step(
        '应用过滤与排序',
        rawEntries,
        outputEntries.length,
        outputTiming,
        '状态/来源/分组/频道/错误码/最低分辨率过滤，明细排序，源级统计排序',
      ),
    ],
    errorCodes: countBy(rawResult.entries, (entry) => entry.errorCode),
  };
}

function applyOutputOptions(
  result: IptvPickerCoreFileResult,
  args: CliArgs,
  sourceLoad: SourceLoadResult,
): IptvPickerCoreFileResult {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const filteredEntries = sortEntries(filterEntries(result.entries, args), args);
  const report = sortReport(buildIptvPickerCoreReportFromEntries(filteredEntries), args);
  const outputTiming = {
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
  };
  const curationPreset = args.curationPreset || 'none';
  const curated = curationPreset !== 'none'
    ? curateChannelEntries(filteredEntries, curationPreset, {
      targetsFilePath: resolve(args.curationTargetsFile),
      aliasesFilePath: resolve(args.curationAliasesFile),
      keepPerChannel: args.curationKeepPerChannel,
      preferredMinHeight: args.curationPreferredMinHeight,
      fallbackMinHeight: args.curationFallbackMinHeight,
      allowLowResFallback: args.curationAllowLowResFallback,
      includeUnmatched: args.curationIncludeUnmatched,
      includeFailed: args.curationIncludeFailed,
    })
    : { entries: filteredEntries, summary: undefined };
  const entries = curated.entries;
  return {
    ...result,
    pipeline: buildPipeline(result, entries, sourceLoad, outputTiming),
    output: {
      filtered: entries.length !== result.entries.length,
      filters: {
        status: args.status,
        source: args.source,
        group: args.group,
        channel: args.channel,
        errorCode: args.errorCode,
        minHeight: args.minHeight,
      },
      sort: args.sort,
      sortDir: args.sortDir,
      reportSort: args.reportSort,
      reportSortDir: args.reportSortDir,
      strategy: args.strategy,
      runtime: {
        downloadTimeoutMs: args.downloadTimeoutMs,
        checkTimeoutMs: args.checkTimeoutMs,
        checkRetry: args.checkRetry,
        checkMode: args.checkMode,
        requireFfmpeg: args.requireFfmpeg,
        ffprobeAvailable: result.runtime?.ffprobeAvailable,
        ffprobePath: result.runtime?.ffprobePath,
        ffprobeSource: result.runtime?.ffprobeSource,
        noFfmpegMode: result.runtime?.noFfmpegMode,
        playbackValidation: result.runtime?.playbackValidation,
        preflight: args.preflight,
        preflightTimeoutMs: args.preflightTimeoutMs,
        hostTimeoutLimit: args.hostTimeoutLimit,
        sourceParallel: args.sourceParallel,
        preflightParallel: args.preflightParallel,
        preflightHostParallel: args.preflightHostParallel,
        checkParallel: args.checkParallel,
        checkHostParallel: args.checkHostParallel,
        pipelineMode: args.pipelineMode,
        preflightCheckpointPath: args.preflightOut,
        resumePreflightPath: args.resumePreflight,
      },
      originalEntries: result.entries.length,
      outputEntries: entries.length,
      channelCurationPreset: curationPreset,
      channelCurationKeepPerChannel: args.curationKeepPerChannel,
      channelCurationPreferredMinHeight: args.curationPreferredMinHeight,
      channelCurationFallbackMinHeight: args.curationFallbackMinHeight,
      channelCurationAllowLowResFallback: args.curationAllowLowResFallback,
      channelCurationPreFilter: args.curationPreFilter,
      channelCurationIncludeUnmatched: args.curationIncludeUnmatched,
      channelCurationIncludeFailed: args.curationIncludeFailed,
      channelCuration: curated.summary,
    },
    report,
    entries,
  };
}

function pad(value: string | number, width: number): string {
  const text = String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function formatRate(value: number): string {
  return `${value.toFixed(2)}%`;
}

function shortIso(value: string | undefined): string {
  return value ? value.replace('T', ' ').replace('Z', '') : '-';
}

function formatDurationMs(value: number | undefined): string {
  if (value == null || !isFinite(value)) return '-';
  const wholeMs = Math.max(0, Math.round(value));
  if (wholeMs < 1000) return `${wholeMs}毫秒`;

  const totalSeconds = wholeMs / 1000;
  if (wholeMs < 60_000) return `${totalSeconds.toFixed(2)}秒`;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const secondText = seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2);

  if (hours > 0) return `${hours}小时${minutes}分${secondText}秒`;
  return `${minutes}分${secondText}秒`;
}

function formatDurationWithRawMs(value: number | undefined): string {
  if (value == null || !isFinite(value)) return '-';
  return `${formatDurationMs(value)} (${Math.max(0, Math.round(value))} ms)`;
}

function shortenLabel(value: string | undefined, max = 36): string {
  if (!value) return '-';
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function logTimestamp(): string {
  const now = new Date();
  const pad2 = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ` +
    `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}

function flushRuntimeLog(): void {
  if (!runtimeLogPath || runtimeLogBuffer.length === 0) return;
  appendFileSync(runtimeLogPath, `${runtimeLogBuffer.join('\n')}\n`, 'utf8');
  runtimeLogBuffer = [];
}

function writeRuntimeLog(line: string): void {
  if (!runtimeLogPath) return;
  runtimeLogBuffer.push(line);
  if (runtimeLogBuffer.length >= 200) flushRuntimeLog();
}

function configureRuntimeLog(args: CliArgs, argv: string[]): void {
  runtimeDebug = args.debug;
  runtimeLogPath = args.noLog ? undefined : resolve(args.logOut || DEFAULT_LOG_PATH);
  if (!runtimeLogPath) return;
  if (runtimeLogFlushTimer) clearInterval(runtimeLogFlushTimer);
  runtimeLogBuffer = [];
  mkdirSync(dirname(runtimeLogPath), { recursive: true });
  writeFileSync(runtimeLogPath, '', 'utf8');
  runtimeLogFlushTimer = setInterval(flushRuntimeLog, 1000);
  runtimeLogFlushTimer.unref?.();
  writeRuntimeLog(`${logTimestamp()} [log:start] [file:${runtimeLogPath}]`);
  if (runtimeDebug) {
    writeRuntimeLog(`${logTimestamp()} [debug] [argv:${JSON.stringify(argv)}]`);
  }
}

function cliLog(message: string): void {
  const line = `${logTimestamp()} ${message}`;
  console.log(line);
  writeRuntimeLog(line);
}

function consoleOnlyLog(message: string): void {
  console.log(`${logTimestamp()} ${message}`);
}

function cliError(message: string): void {
  const line = `${logTimestamp()} ${message}`;
  console.error(line);
  writeRuntimeLog(line);
}

function debugLog(message: string): void {
  if (!runtimeDebug) return;
  writeRuntimeLog(`${logTimestamp()} [debug] ${message}`);
}

function cleanLogValue(value: unknown): string {
  if (value == null || value === '') return '-';
  return String(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\[/g, '【')
    .replace(/\]/g, '】')
    .trim() || '-';
}

function detailLogType(type: string): string {
  const labels: Record<string, string> = {
    'source:start': '直播源开始',
    'source:download:ok': '直播源下载成功',
    'source:download:failed': '直播源下载失败',
    'source:lint:done': '直播源格式检查完成',
    'source:parse:ok': '直播源解析完成',
    'source:preflight:start': 'HTTP预检开始',
    'source:preflight:item': 'HTTP预检明细',
    'source:preflight:done': 'HTTP预检完成',
    'preset:match': '规则命中',
    'preset:drop': '规则未命中',
    'preset:done': '规则过滤完成',
    'preset:timing': '规则过滤耗时',
    'url:check:start': 'URL检测开始',
    'url:check:ok': 'URL检测成功',
    'url:check:failed': 'URL检测失败',
    'url:preflight:failed': 'URL预检失败',
    'runtime:ffmpeg:missing': '运行环境提示',
    'source:done': '直播源完成',
    'stage:start': '阶段开始',
    'stage:done': '阶段完成',
    'stage:resume': '阶段恢复',
    'stage:resume-mismatch': '恢复失效',
  };
  return labels[type] || type;
}

function detailLogKey(type: string, key: string): string {
  if (key === 'sourceName') return '来源名称';
  if (key === 'sourceUrl') return '来源地址';
  if (key === 'url') return type.startsWith('source:') ? '来源地址' : '播放地址';
  const labels: Record<string, string> = {
    index: '序号',
    stage: '阶段',
    name: '名称',
    sources: '直播源数',
    entries: '结果条数',
    cumulativeEntries: '累计结果条数',
    submittedUrls: '提交播放检测URL数',
    checkOk: '播放检测成功URL数',
    checkFailed: '播放检测失败URL数',
    preflightFailed: '预检失败URL数',
    pipelineMode: '流水线',
    mode: '模式',
    status: '状态',
    result: '结果',
    reason: '原因',
    error: '错误',
    errorCode: '错误码',
    message: '说明',
    timeoutMs: '超时',
    hostTimeoutLimit: 'Host超时阈值',
    checkpoint: '检查点',
    checkpointState: '检查点状态',
    file: '文件',
    parallel: '并发',
    hostParallel: '同Host并发',
    durationMs: '耗时',
    downloadMs: '下载',
    parseMs: '解析',
    curationMs: '规则过滤',
    preflightMs: '预检',
    lintMs: '格式检查',
    checkMs: '检测',
    lintErrors: '格式错误数',
    downloadFailed: '下载失败源数',
    m3uSources: 'M3U源数',
    lintErrorSources: '格式错误源数',
    keptUrls: '保留URL数',
    droppedUrls: '剔除URL数',
    sizeKb: '大小',
    fromInline: '内置内容',
    isM3u: '是否M3U',
    format: '格式',
    rawGroups: '原始分组数',
    rawChannels: '原始频道数',
    rawUrls: '原始URL数',
    groups: '分组数',
    channels: '频道数',
    urls: 'URL数',
    preFilter: '提前过滤',
    kept: '保留URL数',
    enabled: '启用',
    input: '输入URL数',
    passed: '通过URL数',
    failed: '失败URL数',
    skipped: '跳过URL数',
    ok: '可用URL数',
    preset: '规则集',
    originalGroup: '原始分组',
    originalChannel: '原始频道',
    targetGroup: '目标分组',
    targetChannel: '目标频道',
    rule: '命中规则',
    matchedAlias: '命中别名',
    group: '分组',
    channel: '频道',
    resolution: '分辨率',
    bitrate: '码率',
    fps: '帧率',
    codec: '编码',
    rawUrlCount: '原始URL数',
    matchedUrls: '命中URL数',
    host: 'Host',
    probeMode: '探测模式',
    warning: '提示',
  };
  if (labels[key]) return labels[key];
  return key;
}

function detailLogValue(key: string, value: unknown): string {
  if (key.endsWith('Ms') && typeof value === 'number') return formatDurationMs(value);
  if (key === 'sizeKb' && typeof value === 'number') return `${value.toFixed(2)}KB`;
  if (typeof value === 'boolean') return value ? '是' : '否';
  if ((key === 'status' || key === 'result') && typeof value === 'string') {
    const labels: Record<string, string> = {
      ok: '成功',
      failed: '失败',
      skipped: '跳过',
      passed: '通过',
      matched: '命中',
      dropped: '剔除',
    };
    return labels[value] || value;
  }
  return cleanLogValue(value);
}

function detailLog(event: IptvPickerCoreDetailLogEvent): void {
  const fields = Object.entries(event.fields)
    .map(([key, value]) => `[${detailLogKey(event.type, key)}:${detailLogValue(key, value)}]`)
    .join(' ');
  const line = `[${detailLogType(event.type)}]${fields ? ` ${fields}` : ''}`;
  if (runtimeLogPath) writeRuntimeLog(`${logTimestamp()} ${line}`);
  writeConsoleDetailLog(event, line);
}

function writeConsoleDetailLog(event: IptvPickerCoreDetailLogEvent, line: string): void {
  if (!currentCliArgs || currentCliArgs.quiet) return;
  if (
    event.type.startsWith('stage:') ||
    event.type === 'runtime:ffmpeg:missing' ||
    event.type === 'source:start' ||
    event.type === 'source:download:failed' ||
    event.type === 'source:preflight:done' ||
    event.type === 'source:done'
  ) {
    consoleOnlyLog(line);
  }
}

function buildTextReport(
  rawResult: IptvPickerCoreFileResult,
  outputResult: IptvPickerCoreFileResult,
  args: CliArgs,
  strategies: StrategyDefinition[] = STRATEGIES,
): string {
  const pipeline = outputResult.pipeline;
  const rawReport = rawResult.report;
  const outputReport = outputResult.report;
  const reportPath = args.noReport ? '-' : resolve(args.reportOut || deriveReportPath(args.out));
  const liveExports = outputResult.output?.liveExports || (outputResult.output?.liveExport ? [outputResult.output.liveExport] : []);
  const sourceRows = rawReport.sources.slice(0, args.topSources);
  const errorRows = (pipeline?.errorCodes || []).slice(0, args.topErrors);
  const okRate = pct(rawResult.status.okUrls, rawResult.status.checkedUrls);
  const outputRate = pct(outputResult.entries.length, rawResult.entries.length);

  const lines: string[] = [];
  lines.push('外部 IPTV 质量检测报告');
  lines.push('======================');
  lines.push(`生成时间   : ${new Date().toISOString()}`);
  lines.push(`检测引擎   : ${resultNoFfmpegMode(rawResult) ? 'no-ffmpeg（未进行 ffprobe 播放质量探测）' : 'iptv-checker + ffprobe'}`);
  lines.push(`输入模式   : ${pipeline?.inputMode === 'input' ? '批量文件' : '单个 URL'}`);
  if (pipeline?.inputFile) lines.push(`输入文件   : ${pipeline.inputFile}`);
  lines.push(`JSON 输出  : ${resolve(args.out)}`);
  lines.push(`文本报告   : ${reportPath}`);
  lines.push(`直播源导出 : ${liveExports.length ? liveExports.map((item) => `${item.file} (${item.format}, ${item.entries} 条)`).join('; ') : '-'}`);
  lines.push('');

  lines.push('命令参数');
  lines.push('--------');
  lines.push(`策略=${strategyLabel(args.strategy, strategies)}`);
  lines.push(`状态=${args.status}, 来源=${args.source || '-'}, 分组=${args.group || '-'}, 频道=${args.channel || '-'}, 错误码=${args.errorCode || '-'}, 最低高度=${args.minHeight ?? '-'}`);
  lines.push(`明细排序=${args.sort}, 明细排序方向=${args.sortDir}, 源级排序=${args.reportSort}, 源级排序方向=${args.reportSortDir}`);
  lines.push(`频道收口=规则 ${args.curationPreset}, 每频道保留 ${args.curationKeepPerChannel ?? '-'}, 优选高度 ${args.curationPreferredMinHeight ?? '-'}, 兜底高度 ${args.curationFallbackMinHeight ?? '-'}, 低清兜底 ${args.curationAllowLowResFallback}, 检测前过滤 ${args.curationPreFilter}, 保留未匹配 ${args.curationIncludeUnmatched}, 包含失败 ${args.curationIncludeFailed}`);
  lines.push(`运行参数=流水线 ${args.pipelineMode}, 检测模式 ${args.checkMode}, ffprobe ${outputResult.output?.runtime?.ffprobeSource || '-'} ${outputResult.output?.runtime?.ffprobePath || '-'}, 强制ffmpeg ${args.requireFfmpeg}, HTTP预检 ${args.preflight}, 预检超时 ${args.preflightTimeoutMs}ms, Host超时阈值 ${args.hostTimeoutLimit}, 源下载超时 ${args.downloadTimeoutMs}ms, URL检测超时 ${args.checkTimeoutMs}ms, URL重试 ${args.checkRetry}, 直播源并发 ${args.sourceParallel}, 预检并发 ${args.preflightParallel}, 同Host预检并发 ${args.preflightHostParallel}, URL检测并发 ${args.checkParallel}, 同Host检测并发 ${args.checkHostParallel}, 预检检查点 ${args.preflightOut}, 恢复预检 ${args.resumePreflight || '-'}`);
  lines.push(`紧凑 JSON=${args.compact}, 静默模式=${args.quiet}`);
  lines.push('');

  lines.push('总体结果');
  lines.push('--------');
  lines.push(`已加载源           : ${pipeline?.loadedSources ?? 0}/${pipeline?.rawSources ?? 0}`);
  lines.push(`已检测 URL         : ${rawResult.status.checkedUrls}`);
  lines.push(`可播放 URL         : ${rawResult.status.okUrls} (${formatRate(okRate)})`);
  lines.push(`失败 URL           : ${rawResult.status.failedUrls}`);
  lines.push(`最终输出条目       : ${outputResult.entries.length} (${formatRate(outputRate)} / 检测条目)`);
  lines.push(`总耗时             : ${formatDurationWithRawMs(rawResult.status.durationMs)}`);
  lines.push('');

  lines.push('步骤耗时与损耗');
  lines.push('--------------');
  lines.push(`${pad('步骤', 26)} ${pad('开始时间', 23)} ${pad('结束时间', 23)} ${pad('耗时', 16)} ${pad('输入', 8)} ${pad('输出', 8)} ${pad('损耗', 8)} ${pad('损耗率', 9)} 说明`);
  for (const item of pipeline?.steps || []) {
    lines.push(`${pad(item.name, 26)} ${pad(shortIso(item.startedAt), 23)} ${pad(shortIso(item.finishedAt), 23)} ${pad(formatDurationMs(item.durationMs), 16)} ${pad(item.input, 8)} ${pad(item.output, 8)} ${pad(item.lost, 8)} ${pad(formatRate(item.lossRate), 9)} ${item.note || ''}`);
  }
  lines.push('');

  if (rawResult.timing?.sources.length) {
    const slowSources = rawResult.timing.sources
      .slice()
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, args.topSources);
    lines.push('最慢来源');
    lines.push('--------');
    lines.push(`${pad('总耗时', 16)} ${pad('下载', 12)} ${pad('解析', 10)} ${pad('预检', 10)} ${pad('检测', 12)} ${pad('可用', 5)} ${pad('失败', 6)} 来源`);
    for (const item of slowSources) {
      lines.push(`${pad(formatDurationMs(item.durationMs), 16)} ${pad(formatDurationMs(item.downloadMs), 12)} ${pad(formatDurationMs(item.parseMs), 10)} ${pad(formatDurationMs(item.preflightMs), 10)} ${pad(formatDurationMs(item.checkMs), 12)} ${pad(item.okEntries, 5)} ${pad(item.failedEntries, 6)} ${item.sourceName}`);
    }
    lines.push('');
  }

  lines.push('原始源统计');
  lines.push('----------');
  lines.push(`原始统计：来源 ${rawReport.totalSources} 个，URL ${rawReport.totalUrls} 条，可用 ${rawReport.okUrls} 条，失败 ${rawReport.failedUrls} 条，格式错误 ${rawReport.formatErrors} 个`);
  lines.push(`${pad('可用率', 9)} ${pad('可用', 6)} ${pad('失败', 7)} ${pad('总数', 7)} 来源`);
  for (const source of sourceRows) {
    lines.push(`${pad(formatRate(pct(source.okUrls, source.totalUrls)), 9)} ${pad(source.okUrls, 6)} ${pad(source.failedUrls, 7)} ${pad(source.totalUrls, 7)} ${source.sourceName || source.sourceUrl}`);
  }
  if (rawReport.sources.length > sourceRows.length) {
    lines.push(`... 还有 ${rawReport.sources.length - sourceRows.length} 个来源未显示`);
  }
  lines.push('');

  lines.push('过滤后输出统计');
  lines.push('--------------');
  lines.push(`输出统计：来源 ${outputReport.totalSources} 个，URL ${outputReport.totalUrls} 条，可用 ${outputReport.okUrls} 条，失败 ${outputReport.failedUrls} 条，格式错误 ${outputReport.formatErrors} 个`);
  lines.push(`过滤条件：${JSON.stringify(outputResult.output?.filters || {})}`);
  lines.push('');

  const curation = outputResult.output?.channelCuration;
  if (curation) {
    lines.push('频道收口统计');
    lines.push('------------');
    lines.push(`规则=${curation.preset}, 目标频道=${curation.targets}, 命中=${curation.matchedTargets}, 缺失=${curation.missingTargets}, 候选=${curation.candidates}, 保留=${curation.kept}, 冲突剔除=${curation.conflictRejected || 0}`);
    if (curation.missing.length > 0) {
      lines.push(`缺失频道：${curation.missing.join('、')}`);
    }
    lines.push('');
  }

  lines.push('错误码分布');
  lines.push('----------');
  if (errorRows.length === 0) {
    lines.push('无错误。');
  } else {
    lines.push(`${pad('数量', 8)} 错误码`);
    for (const item of errorRows) {
      lines.push(`${pad(item.count, 8)} ${item.code}`);
    }
    if ((pipeline?.errorCodes.length || 0) > errorRows.length) {
      lines.push(`... 还有 ${(pipeline?.errorCodes.length || 0) - errorRows.length} 个错误码未显示`);
    }
  }
  lines.push('');

  lines.push('损耗解读');
  lines.push('--------');
  if ((pipeline?.droppedSources || 0) > 0) {
    lines.push(`- ${pipeline?.droppedSources} 条输入源记录因禁用或 URL 为空被跳过。`);
  }
  if (rawResult.status.failedUrls > 0) {
    lines.push(`- ${rawResult.status.failedUrls} 条 URL 播放检测或预检失败，请查看 JSON 中的 errorCode/errorMessage。`);
  }
  if (outputResult.entries.length < rawResult.entries.length) {
    lines.push(`- ${rawResult.entries.length - outputResult.entries.length} 条已检测记录被输出过滤条件移除。`);
  }
  if (rawResult.status.okUrls === 0) {
    lines.push('- 未发现可播放 URL，候选源质量可能较差，或当前网络无法访问。');
  } else {
    lines.push('- 已发现可播放 URL，后续发布建议优先选择 ok=true 且分辨率/码率更高的条目。');
  }
  lines.push('');
  return lines.join('\n');
}

function md(value: unknown): string {
  return String(value ?? '-')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim() || '-';
}

function isChannelUrlEntry(entry: IptvPickerCoreChannelEntry): boolean {
  return !!(entry.channel || entry.group);
}

function entryGroup(entry: IptvPickerCoreChannelEntry): string {
  return entry.group || '未分组';
}

function entryChannel(entry: IptvPickerCoreChannelEntry): string {
  return entry.channel || '未命名';
}

function entryChannelKey(entry: IptvPickerCoreChannelEntry): string {
  return `${entryGroup(entry)}\u0000${entryChannel(entry)}`;
}

function formatBitrate(value: number | null | undefined): string {
  if (value == null || !isFinite(Number(value))) return '-';
  const n = Number(value);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} Mbps`;
  if (n >= 1000) return `${Math.round(n / 1000)} Kbps`;
  return `${Math.round(n)} bps`;
}

function formatMetric(value: unknown): string {
  return value == null || value === '' ? '-' : String(value);
}

function sourceEntryKey(entry: IptvPickerCoreChannelEntry): string {
  return entry.sourceUrl || entry.sourceName || 'unknown';
}

function formatTopErrors(entries: IptvPickerCoreChannelEntry[], limit = 3): string {
  const rows = countBy(entries.filter((entry) => !entry.ok), (entry) => entry.errorCode || 'UNKNOWN').slice(0, limit);
  return rows.length ? rows.map((item) => `${item.code}:${item.count}`).join(', ') : '-';
}

function sourceQualityGrade(okUrls: number, urls: number, formatErrors: number, downloadFailed: boolean): string {
  const rate = pct(okUrls, urls);
  if (downloadFailed) return '下载失败';
  if (urls === 0) return '无频道';
  if (formatErrors > 0 && okUrls === 0) return '格式异常';
  if (okUrls >= 50 && rate >= 50) return '优秀';
  if (okUrls >= 10 && rate >= 20) return '可用';
  if (okUrls > 0) return '观察';
  return '建议禁用';
}

function sourceAdvice(grade: string, okUrls: number, urls: number, matchedUrls: number | undefined): string {
  if (grade === '未探测') return '安装 ffmpeg 后复测';
  if (grade === '优秀') return '保留';
  if (grade === '可用') return '保留';
  if (grade === '观察') return matchedUrls && matchedUrls > 0 ? '观察，模板有覆盖' : '观察';
  if (grade === '无频道') return '检查格式或禁用';
  if (grade === '下载失败') return '检查网络或禁用';
  if (grade === '格式异常') return '修复格式或禁用';
  if (urls > 0 && okUrls === 0) return '建议禁用';
  return '观察';
}

function hostOfUrl(value: string | undefined): string {
  if (!value) return '未知';
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    const match = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
    return match ? match[1].toLowerCase() : '未知';
  }
}

function buildSourceStatsMarkdown(
  rawResult: IptvPickerCoreFileResult,
  outputResult: IptvPickerCoreFileResult,
  args: CliArgs,
): string {
  const curationPreset = args.curationPreset || 'none';
  const noFfmpegMode = resultNoFfmpegMode(rawResult);
  const timingSources = rawResult.timing?.sources || [];
  const summaryBySource = new Map(rawResult.report.sources.map((source) => [source.sourceUrl, source]));
  const rows = (timingSources.length
    ? timingSources
    : rawResult.report.sources.map((source) => ({
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl,
      rawGroups: undefined,
      rawChannels: undefined,
      rawUrls: undefined,
      matchedGroups: undefined,
      matchedChannels: undefined,
      matchedUrls: undefined,
      templateDroppedUrls: undefined,
      preflightPassedUrls: undefined,
      preflightFailedUrls: undefined,
      preflightSkippedUrls: undefined,
      entries: source.totalUrls,
      okEntries: source.okUrls,
      failedEntries: source.failedUrls,
      lintErrors: source.formatErrors,
      downloadFailed: false,
      finishedAt: source.checkedAt,
    }))).map((source) => {
    const entries = rawResult.entries.filter((entry) => sourceEntryKey(entry) === source.sourceUrl);
    const urlEntries = entries.filter(isChannelUrlEntry);
    const okEntries = urlEntries.filter((entry) => entry.ok);
    const okChannelSet = new Set(okEntries.map(entryChannelKey));
    const playbackEntries = urlEntries.filter((entry) => entry.ok || !String(entry.errorCode || '').startsWith('PREFLIGHT_') && entry.errorCode !== 'HOST_PREFLIGHT_SKIPPED');
    const rawGroups = source.rawGroups ?? new Set(urlEntries.map(entryGroup)).size;
    const rawChannels = source.rawChannels ?? new Set(urlEntries.map(entryChannelKey)).size;
    const rawUrls = source.rawUrls ?? urlEntries.length;
    const matchedGroups = curationPreset === 'none' ? undefined : source.matchedGroups ?? rawGroups;
    const matchedChannels = curationPreset === 'none' ? undefined : source.matchedChannels ?? rawChannels;
    const matchedUrls = curationPreset === 'none' ? undefined : source.matchedUrls ?? urlEntries.length;
    const templateDroppedUrls = curationPreset === 'none' ? undefined : source.templateDroppedUrls ?? Math.max(0, rawUrls - (matchedUrls || 0));
    const preflightPassedUrls = source.preflightPassedUrls ?? playbackEntries.length;
    const preflightFailedUrls = source.preflightFailedUrls ?? Math.max(0, urlEntries.length - playbackEntries.length);
    const preflightSkippedUrls = source.preflightSkippedUrls ?? entries.filter((entry) => entry.errorCode === 'HOST_PREFLIGHT_SKIPPED').length;
    const sourceSummary = summaryBySource.get(source.sourceUrl);
    const formatErrors = source.lintErrors ?? sourceSummary?.formatErrors ?? entries.filter((entry) => entry.errorCode === 'LINT_FAILED').length;
    return {
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl,
      rawGroups,
      rawChannels,
      rawUrls,
      okChannels: okChannelSet.size,
      okUrls: okEntries.length,
      matchedGroups,
      matchedChannels,
      matchedUrls,
      templateDroppedUrls,
      preflightPassedUrls,
      preflightFailedUrls,
      preflightSkippedUrls,
      checkUrls: playbackEntries.length,
      formatErrors,
      downloadFailed: source.downloadFailed || entries.some((entry) => entry.errorCode === 'SOURCE_DOWNLOAD_FAILED'),
      topErrors: formatTopErrors(entries),
      checkedAt: source.finishedAt || sourceSummary?.checkedAt || '-',
    };
  });
  const totalRawUrls = rows.reduce((sum, row) => sum + row.rawUrls, 0);
  const totalOkUrls = rows.reduce((sum, row) => sum + row.okUrls, 0);
  const totalMatchedUrls = rows.reduce((sum, row) => sum + (row.matchedUrls || 0), 0);
  const totalTemplateDroppedUrls = rows.reduce((sum, row) => sum + (row.templateDroppedUrls || 0), 0);
  const totalPreflightPassedUrls = rows.reduce((sum, row) => sum + row.preflightPassedUrls, 0);
  const totalPreflightFailedUrls = rows.reduce((sum, row) => sum + row.preflightFailedUrls, 0);
  const totalPreflightSkippedUrls = rows.reduce((sum, row) => sum + row.preflightSkippedUrls, 0);
  const totalCheckUrls = rows.reduce((sum, row) => sum + row.checkUrls, 0);

  const lines: string[] = [];
  lines.push('# 直播源统计报告');
  lines.push('');
  lines.push(`生成时间：${new Date().toISOString()}`);
  lines.push(`输入文件：${md(outputResult.pipeline?.inputFile || '-')}`);
  lines.push(`策略：${md(args.strategy || '-')}`);
  lines.push(`模板：${curationPreset === 'none' ? '未启用' : curationPreset}`);
  lines.push(`探测模式：${noFfmpegMode ? 'no-ffmpeg（未进行 ffprobe 播放质量探测）' : 'ffmpeg'}`);
  if (noFfmpegMode) lines.push(`提示：${noFfmpegNotice()}`);
  lines.push('');
  lines.push('## 每个直播源');
  lines.push('');
  lines.push('| 直播源 | 分级 | 建议 | 可用率 | 原始分组数 | 原始频道数 | 原始 URL 数 | 模板匹配频道数 | 模板匹配 URL 数 | 模板剔除 URL 数 | 预检通过 URL 数 | 预检失败 URL 数 | 播放检测 URL 数 | 测试通过频道数 | 测试通过 URL 数 | 失败原因 Top | 格式错误 | 地址 |');
  lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |');
  for (const row of rows) {
    const qualityDenominator = row.matchedUrls ?? row.rawUrls;
    const grade = noFfmpegMode ? '未探测' : sourceQualityGrade(row.okUrls, qualityDenominator, row.formatErrors, row.downloadFailed);
    const advice = sourceAdvice(grade, row.okUrls, qualityDenominator, row.matchedUrls);
    lines.push(`| ${md(row.sourceName)} | ${md(grade)} | ${md(advice)} | ${formatRate(pct(row.okUrls, qualityDenominator))} | ${row.rawGroups} | ${row.rawChannels} | ${row.rawUrls} | ${row.matchedChannels ?? '-'} | ${row.matchedUrls ?? '-'} | ${row.templateDroppedUrls ?? '-'} | ${row.preflightPassedUrls} | ${row.preflightFailedUrls} | ${row.checkUrls} | ${row.okChannels} | ${row.okUrls} | ${md(row.topErrors)} | ${row.formatErrors} | ${md(row.sourceUrl)} |`);
  }
  lines.push('');
  lines.push('## 汇总');
  lines.push('');
  lines.push(`- 直播源数量：${timingSources.length || rawResult.report.totalSources}`);
  lines.push(`- 原始 URL 数量：${totalRawUrls}`);
  if (curationPreset !== 'none') {
    lines.push(`- 模板匹配 URL 数量：${totalMatchedUrls}`);
    lines.push(`- 模板剔除 URL 数量：${totalTemplateDroppedUrls}`);
  }
  lines.push(`- 预检通过 URL 数量：${totalPreflightPassedUrls}`);
  lines.push(`- 预检失败 URL 数量：${totalPreflightFailedUrls}`);
  lines.push(`- Host 熔断跳过 URL 数量：${totalPreflightSkippedUrls}`);
  lines.push(`- 播放检测 URL 数量：${totalCheckUrls}`);
  lines.push(`- 测试通过 URL 数量：${totalOkUrls}`);
  lines.push(`- 测试失败 URL 数量：${Math.max(0, totalCheckUrls - totalOkUrls)}`);
  lines.push(`- 最终输出 URL 数量：${outputResult.entries.length}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function sourceLabel(entry: IptvPickerCoreChannelEntry): string {
  const name = entry.sourceName || '未知来源';
  const url = entry.sourceUrl || '-';
  return `${name} (${url})`;
}

function buildOutputChannelStatsMarkdown(
  outputResult: IptvPickerCoreFileResult,
  args: CliArgs,
): string {
  const noFfmpegMode = resultNoFfmpegMode(outputResult);
  const entriesByKey = new Map<string, IptvPickerCoreChannelEntry[]>();
  for (const entry of outputResult.entries) {
    const key = entryChannelKey(entry);
    const list = entriesByKey.get(key) || [];
    list.push(entry);
    entriesByKey.set(key, list);
  }

  const curation = outputResult.output?.channelCuration;
  const channelRows = curation
    ? curation.groups.map((item) => ({ group: item.group, channel: item.label }))
    : Array.from(entriesByKey.keys()).map((key) => {
      const [group, channel] = key.split('\u0000');
      return { group, channel };
    }).sort((a, b) => a.group.localeCompare(b.group, 'zh-CN') || a.channel.localeCompare(b.channel, 'zh-CN'));

  const seenKeys = new Set(channelRows.map((item) => `${item.group}\u0000${item.channel}`));
  for (const key of entriesByKey.keys()) {
    if (seenKeys.has(key)) continue;
    const [group, channel] = key.split('\u0000');
    channelRows.push({ group, channel });
    seenKeys.add(key);
  }

  const lines: string[] = [];
  lines.push('# 产出频道统计报告');
  lines.push('');
  lines.push(`生成时间：${new Date().toISOString()}`);
  lines.push(`JSON 输出：${md(resolve(args.out))}`);
  lines.push(`策略：${md(args.strategy || '-')}`);
  lines.push(`频道收口：${md(outputResult.output?.channelCurationPreset || 'none')}`);
  lines.push(`探测模式：${noFfmpegMode ? 'no-ffmpeg（未进行 ffprobe 播放质量探测）' : 'ffmpeg'}`);
  if (noFfmpegMode) lines.push(`提示：${noFfmpegNotice()}`);
  lines.push('');
  lines.push('## 概览');
  lines.push('');
  lines.push(`- 分组数量：${new Set(channelRows.map((item) => item.group)).size}`);
  lines.push(`- 频道数量：${channelRows.length}`);
  lines.push(`- URL 数量：${outputResult.entries.length}`);
  if (curation) {
    lines.push(`- 模板目标频道数量：${curation.targets}`);
    lines.push(`- 模板命中频道数量：${curation.matchedTargets}`);
    lines.push(`- 模板缺失频道数量：${curation.missingTargets}`);
    lines.push(`- 冲突剔除 URL 数量：${curation.conflictRejected || 0}`);
    lines.push(`- 高清优选 URL 数量：${curation.preferredKept || 0}`);
    lines.push(`- 清晰兜底 URL 数量：${curation.fallbackKept || 0}`);
    lines.push(`- 低清兜底 URL 数量：${curation.lowResFallbackKept || 0}`);
  }
  lines.push('');
  lines.push(noFfmpegMode
    ? '说明：当前为 `no-ffmpeg` 模式，URL 已解析和收口，但未进行 ffprobe 播放质量探测；分辨率、码率、FPS、编码和格式会为空。'
    : '说明：连接速度、下载速度当前检测结果未采集，暂以 `-` 表示；分辨率、码率、FPS 来自 ffprobe/iptv-checker 探测结果。质量等级中“高清优选”表示达到优选高度，“清晰兜底”表示达到兜底高度，“低清兜底”表示为保覆盖保留的低清可播线路。');
  lines.push('');

  if (curation?.missing.length) {
    lines.push('## 缺失频道汇总');
    lines.push('');
    for (const item of curation.missing) {
      lines.push(`- ${md(item)}`);
    }
    lines.push('');
  }

  const hostRows = countBy(outputResult.entries, (entry) => hostOfUrl(entry.bareUrl));
  if (hostRows.length > 0) {
    lines.push('## Host 分布');
    lines.push('');
    lines.push('| Host | URL 数量 | 占比 |');
    lines.push('| --- | ---: | ---: |');
    for (const row of hostRows) {
      lines.push(`| ${md(row.code)} | ${row.count} | ${formatRate(pct(row.count, outputResult.entries.length))} |`);
    }
    lines.push('');
  }

  lines.push('## 频道明细');
  lines.push('');
  lines.push('| 分组 | 频道 | 频道 URL 数量 | URL | 来源 | 质量等级 | 分辨率 | 码率 | FPS | 编码 | 格式 | 连接速度 | 下载速度 | 检测时间 |');
  lines.push('| --- | --- | ---: | --- | --- | --- | --- | ---: | ---: | --- | --- | ---: | ---: | --- |');
  for (const item of channelRows) {
    const key = `${item.group}\u0000${item.channel}`;
    const entries = entriesByKey.get(key) || [];
    if (entries.length === 0) {
      lines.push(`| ${md(item.group)} | ${md(item.channel)} | 0 | - | - | - | - | - | - | - | - | - | - | - |`);
      continue;
    }
    for (const entry of entries) {
      lines.push(`| ${md(item.group)} | ${md(item.channel)} | ${entries.length} | ${md(entry.bareUrl)} | ${md(sourceLabel(entry))} | ${md(formatMetric(entry.curationQualityLabel))} | ${md(formatMetric(entry.resolution))} | ${md(formatBitrate(entry.bitrate))} | ${md(formatMetric(entry.fps))} | ${md(formatMetric(entry.codec))} | ${md(formatMetric(entry.formatName))} | - | - | ${md(entry.checkedAt)} |`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildRunningRawResult(
  entries: IptvPickerCoreChannelEntry[],
  status: IptvPickerCoreFileResult['status'],
): IptvPickerCoreFileResult {
  const now = new Date().toISOString();
  return {
    generatedAt: now,
    status: {
      ...status,
      state: 'running',
    },
    report: buildIptvPickerCoreReportFromEntries(entries),
    entries,
  };
}

function writeRunningOutputs(
  entries: IptvPickerCoreChannelEntry[],
  status: IptvPickerCoreFileResult['status'],
  args: CliArgs,
  sourceLoad: SourceLoadResult,
  paths: {
    out: string;
    sourceStatsOut?: string;
    channelStatsOut?: string;
  },
  _strategies: StrategyDefinition[],
): void {
  const rawRunning = buildRunningRawResult(entries, status);
  const outputRunning = applyOutputOptions(rawRunning, args, sourceLoad);
  const runningOut = deriveRunningPath(paths.out);
  if (outputRunning.output) {
    outputRunning.output.markdownReports = args.noMdReports ? undefined : {
      sourceStats: paths.sourceStatsOut ? deriveRunningPath(paths.sourceStatsOut) : undefined,
      channelStats: paths.channelStatsOut ? deriveRunningPath(paths.channelStatsOut) : undefined,
    };
  }

  mkdirSync(dirname(runningOut), { recursive: true });
  writeFileSync(runningOut, args.compact ? JSON.stringify(outputRunning) : JSON.stringify(outputRunning, null, 2), 'utf8');

  if (paths.sourceStatsOut) {
    const runningSourceStats = deriveRunningPath(paths.sourceStatsOut);
    const sourceStats = buildSourceStatsMarkdown(rawRunning, outputRunning, args);
    mkdirSync(dirname(runningSourceStats), { recursive: true });
    writeFileSync(runningSourceStats, sourceStats, 'utf8');
    mkdirSync(dirname(paths.sourceStatsOut), { recursive: true });
    writeFileSync(paths.sourceStatsOut, sourceStats, 'utf8');
  }
  if (paths.channelStatsOut) {
    const runningChannelStats = deriveRunningPath(paths.channelStatsOut);
    mkdirSync(dirname(runningChannelStats), { recursive: true });
    writeFileSync(runningChannelStats, buildOutputChannelStatsMarkdown(outputRunning, args), 'utf8');
  }

  if (args.exportLive) {
    const runningLiveExports = buildLiveExports(outputRunning, { ...args, exportLive: deriveRunningPath(args.exportLive) });
    for (const liveExport of runningLiveExports) {
      mkdirSync(dirname(liveExport.file), { recursive: true });
      writeFileSync(liveExport.file, liveExport.content, 'utf8');
    }
  }
}

function writeRunningPlaceholders(args: CliArgs, paths: {
  out: string;
  sourceStatsOut?: string;
  channelStatsOut?: string;
}): void {
  const now = new Date().toISOString();
  const runningOut = deriveRunningPath(paths.out);
  mkdirSync(dirname(runningOut), { recursive: true });
  writeFileSync(runningOut, JSON.stringify({
    generatedAt: now,
    status: { state: 'running' },
    entries: [],
  }, null, 2), 'utf8');
  if (paths.sourceStatsOut) {
    const file = deriveRunningPath(paths.sourceStatsOut);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `# 直播源统计报告\n\n生成时间：${now}\n\n检测任务运行中，等待首个直播源完成。\n`, 'utf8');
    mkdirSync(dirname(paths.sourceStatsOut), { recursive: true });
    writeFileSync(paths.sourceStatsOut, `# 直播源统计报告\n\n生成时间：${now}\n\n检测任务运行中，等待首个直播源完成。\n\n## 汇总\n\n- 直播源数量：0\n- URL 数量：0\n- 测试通过 URL 数量：0\n- 测试失败 URL 数量：0\n- 最终输出 URL 数量：0\n`, 'utf8');
  }
  if (paths.channelStatsOut) {
    const file = deriveRunningPath(paths.channelStatsOut);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `# 产出频道统计报告\n\n生成时间：${now}\n\n检测任务运行中，等待首个直播源完成。\n`, 'utf8');
  }
  if (args.exportLive) {
    for (const item of deriveLiveExportFiles(deriveRunningPath(args.exportLive))) {
      const file = resolve(item.file);
      mkdirSync(dirname(file), { recursive: true });
      if (item.format === 'm3u') writeFileSync(file, '#EXTM3U\n', 'utf8');
      else if (item.format === 'txt') writeFileSync(file, '', 'utf8');
      else writeFileSync(file, `${JSON.stringify({ generatedAt: now, format: 'iptv-json', entries: [] }, null, 2)}\n`, 'utf8');
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  configureRuntimeLog(args, argv);
  if (args.publishSyncOnly) {
    await runPublishSyncOnly(args);
    return;
  }
  if (args.initDefaultSources) {
    ensureDefaultSourceFile(DEFAULT_INPUT_PATH);
    cliLog(`[ready:sources] [file:${DEFAULT_INPUT_PATH}]`);
    return;
  }
  const strategyFile = resolve(args.strategyFile);
  const channelTargetsFile = resolve(args.curationTargetsFile);
  const channelAliasesFile = resolve(args.curationAliasesFile);
  debugLog(`[config] [strategyFile:${strategyFile}] [channelTargets:${channelTargetsFile}] [channelAliases:${channelAliasesFile}]`);
  if (args.initDefaultStrategies) {
    ensureDefaultStrategyFile(strategyFile);
    cliLog(`[ready:strategy] [file:${strategyFile}]`);
    return;
  }
  if (args.initDefaultChannelTargets) {
    ensureDefaultChannelTargetsFile(channelTargetsFile);
    cliLog(`[ready:channel-targets] [file:${channelTargetsFile}]`);
    return;
  }
  if (args.initDefaultChannelAliases) {
    ensureDefaultChannelAliasesFile(channelAliasesFile);
    cliLog(`[ready:channel-aliases] [file:${channelAliasesFile}]`);
    return;
  }
  const strategyCatalog = loadStrategies(strategyFile);
  debugLog(`[strategies] [count:${strategyCatalog.strategies.length}] [default:${strategyCatalog.defaultStrategy}] [defaultCuration:${strategyCatalog.defaultCurationPreset}]`);
  if (args.listStrategies) {
    printStrategies(strategyCatalog.strategies, strategyCatalog.defaultStrategy, strategyFile);
    return;
  }
  if (args.interactive && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error('Interactive mode requires a terminal TTY. Run it in a terminal, or use --url/--input arguments.');
  }
  if (args.interactive || (argv.length === 0 && process.stdin.isTTY)) {
    args = await promptCliArgs(args, strategyCatalog.strategies, strategyCatalog.defaultStrategy, strategyCatalog.defaultCurationPreset);
  } else {
    if (!args.url && !args.input && args.strategy) {
      args.input = DEFAULT_INPUT_PATH;
    }
    args = applyStrategy(args, strategyCatalog.strategies);
  }
  currentCliArgs = args;

  const sourceLoad = loadSources(args);
  debugLog(`[input] [mode:${sourceLoad.inputMode}] [file:${sourceLoad.inputFile || '-'}] [rawSources:${sourceLoad.rawSourceCount}] [loadedSources:${sourceLoad.sources.length}] [droppedSources:${sourceLoad.droppedSourceCount}]`);
  if (sourceLoad.sources.length === 0) {
    throw new Error('No sources provided. Use --url or --input.\n' + usage());
  }

  const out = resolve(args.out);
  const reportOut = undefined;
  const sourceStatsOut = args.noMdReports ? undefined : resolve(args.sourceStatsOut || deriveSourceStatsReportPath(args.out));
  const channelStatsOut = args.noMdReports ? undefined : resolve(args.channelStatsOut || deriveChannelStatsReportPath(args.out));
  const outputPaths = { out, sourceStatsOut, channelStatsOut };
  debugLog(`[output] [out:${out}] [report:${reportOut || '-'}] [sourceStats:${sourceStatsOut || '-'}] [channelStats:${channelStatsOut || '-'}] [live:${args.exportLive || '-'}] [strategy:${args.strategy || '-'}] [curation:${args.curationPreset}] [keep:${args.curationKeepPerChannel ?? '-'}] [preferredHeight:${args.curationPreferredMinHeight ?? '-'}] [fallbackHeight:${args.curationFallbackMinHeight ?? '-'}] [lowResFallback:${args.curationAllowLowResFallback}] [preFilter:${args.curationPreFilter}] [includeUnmatched:${args.curationIncludeUnmatched}] [includeFailed:${args.curationIncludeFailed}]`);
  debugLog(`[runtime] [pipelineMode:${args.pipelineMode}] [checkMode:${args.checkMode}] [ffprobePath:${args.ffprobePath || process.env.FFPROBE_PATH || '-'}] [requireFfmpeg:${args.requireFfmpeg}] [preflight:${args.preflight}] [preflightTimeoutMs:${args.preflightTimeoutMs}] [hostTimeoutLimit:${args.hostTimeoutLimit}] [downloadTimeoutMs:${args.downloadTimeoutMs}] [checkTimeoutMs:${args.checkTimeoutMs}] [checkRetry:${args.checkRetry}] [sourceParallel:${args.sourceParallel}] [preflightParallel:${args.preflightParallel}] [preflightHostParallel:${args.preflightHostParallel}] [checkParallel:${args.checkParallel}] [checkHostParallel:${args.checkHostParallel}] [preflightOut:${args.preflightOut}] [resumePreflight:${args.resumePreflight || '-'}]`);
  if (!args.noProgressOutput) {
    writeRunningPlaceholders(args, outputPaths);
    debugLog(`[progress-output] [json:${deriveRunningPath(out)}] [live:${args.exportLive ? liveExportBasePath(deriveRunningPath(args.exportLive)) + '.{m3u,txt,json}' : '-'}]`);
  }
  if (!args.quiet && runtimeLogPath) cliLog(`[log:file] [path:${runtimeLogPath}] [debug:${runtimeDebug}]`);
  if (!args.quiet) cliLog(`[action:check] [sources:${sourceLoad.sources.length}]`);
  const result = await checkIptvPickerCoreSources(sourceLoad.sources, (status, event?: IptvPickerCoreProgressEvent) => {
    if (!args.quiet) {
      const sourceTiming = status.lastFinishedSourceName
        ? ` [done:${shortenLabel(status.lastFinishedSourceName)}]` +
          ` [duration:${formatDurationMs(status.lastFinishedSourceDurationMs)}]` +
          ` [download:${formatDurationMs(status.lastFinishedSourceDownloadMs)}]` +
          ` [parse:${formatDurationMs(status.lastFinishedSourceParseMs)}]` +
          ` [curation:${formatDurationMs(status.lastFinishedSourceCurationMs)}]` +
          ` [preflight:${formatDurationMs(status.lastFinishedSourcePreflightMs)}]` +
          ` [lint:${formatDurationMs(status.lastFinishedSourceLintMs)}]` +
          ` [check:${formatDurationMs(status.lastFinishedSourceCheckMs)}]`
        : status.currentSourceName
          ? ` [current:${shortenLabel(status.currentSourceName)}] [elapsed:${formatDurationMs(status.currentSourceElapsedMs)}]`
          : '';
      cliLog(
        `[sources:${status.checkedSources}/${status.totalSources}] ` +
        `[urls:${status.checkedUrls} checked] [ok:${status.okUrls}] [failed:${status.failedUrls}]${sourceTiming}`,
      );
    }
    if (!args.noProgressOutput && event?.sourceEntries) {
      writeRunningOutputs(event.allEntries || [], status, args, sourceLoad, outputPaths, strategyCatalog.strategies);
      debugLog(`[progress-output] [sources:${status.checkedSources}/${status.totalSources}] [entries:${event.allEntries?.length || 0}] [file:${deriveRunningPath(out)}]`);
    }
  }, {
    downloadTimeoutMs: args.downloadTimeoutMs,
    checkTimeoutMs: args.checkTimeoutMs,
    checkRetry: args.checkRetry,
    checkMode: args.checkMode,
    requireFfmpeg: args.requireFfmpeg,
    ffprobePath: args.ffprobePath,
    preflight: args.preflight,
    preflightTimeoutMs: args.preflightTimeoutMs,
    hostTimeoutLimit: args.hostTimeoutLimit,
    sourceParallel: args.sourceParallel,
    preflightParallel: args.preflightParallel,
    preflightHostParallel: args.preflightHostParallel,
    checkParallel: args.checkParallel,
    checkHostParallel: args.checkHostParallel,
    pipelineMode: args.pipelineMode,
    preflightCheckpointPath: resolve(args.preflightOut),
    resumePreflightPath: args.resumePreflight ? resolve(args.resumePreflight) : undefined,
    onDetailLog: detailLog,
    preCheckCuration: args.curationPreFilter && args.curationPreset !== 'none'
      ? {
        enabled: true,
        preset: args.curationPreset,
        targetsFilePath: resolve(args.curationTargetsFile),
        aliasesFilePath: resolve(args.curationAliasesFile),
      }
      : undefined,
  });

  const outputResult = applyOutputOptions(result, args, sourceLoad);
  const liveExports = buildLiveExports(outputResult, args);
  if (liveExports.length > 0 && outputResult.output) {
    const primaryLiveExportFormat = inferLiveExportFormat(args.exportLive, args.exportFormat);
    const primaryLiveExport = liveExports.find((item) => item.format === primaryLiveExportFormat) || liveExports[0];
    outputResult.output.liveExports = liveExports.map((item) => ({
      file: item.file,
      format: item.format,
      entries: item.entries.length,
      okOnly: !args.exportAll,
    }));
    outputResult.output.liveExport = {
      file: primaryLiveExport.file,
      format: primaryLiveExport.format,
      entries: primaryLiveExport.entries.length,
      okOnly: !args.exportAll,
    };
  }
  if (outputResult.output && !args.noMdReports) {
    outputResult.output.markdownReports = {
      sourceStats: sourceStatsOut,
      channelStats: channelStatsOut,
    };
  }
  mkdirSync(dirname(out), { recursive: true });
  const sourceStatsReport = sourceStatsOut ? buildSourceStatsMarkdown(result, outputResult, { ...args, reportOut }) : undefined;
  const channelStatsReport = channelStatsOut ? buildOutputChannelStatsMarkdown(outputResult, { ...args, reportOut }) : undefined;
  const writeStartMs = Date.now();
  const writeStartedAt = new Date(writeStartMs).toISOString();
  writeFileSync(out, args.compact ? JSON.stringify(outputResult) : JSON.stringify(outputResult, null, 2), 'utf8');
  for (const liveExport of liveExports) {
    mkdirSync(dirname(liveExport.file), { recursive: true });
    writeFileSync(liveExport.file, liveExport.content, 'utf8');
  }
  if (sourceStatsOut && sourceStatsReport) {
    mkdirSync(dirname(sourceStatsOut), { recursive: true });
    writeFileSync(sourceStatsOut, sourceStatsReport, 'utf8');
  }
  if (channelStatsOut && channelStatsReport) {
    mkdirSync(dirname(channelStatsOut), { recursive: true });
    writeFileSync(channelStatsOut, channelStatsReport, 'utf8');
  }
  const writeTiming = {
    startedAt: writeStartedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - writeStartMs,
  };
  if (outputResult.pipeline) {
    outputResult.pipeline.steps.push(step(
      '写入输出文件',
      outputResult.entries.length,
      outputResult.entries.length,
      writeTiming,
      'JSON 结果文件、Markdown 统计报告和直播源导出文件',
    ));
  }
  writeFileSync(out, args.compact ? JSON.stringify(outputResult) : JSON.stringify(outputResult, null, 2), 'utf8');
  for (const liveExport of liveExports) writeFileSync(liveExport.file, liveExport.content, 'utf8');
  if (sourceStatsOut) writeFileSync(sourceStatsOut, buildSourceStatsMarkdown(result, outputResult, { ...args, reportOut }), 'utf8');
  if (channelStatsOut) writeFileSync(channelStatsOut, buildOutputChannelStatsMarkdown(outputResult, { ...args, reportOut }), 'utf8');
  const publishedArtifacts = shouldPublishOutput(outputResult, args)
    ? publishMatchedOutput(liveExports)
    : [];
  if (publishedArtifacts.length > 0 && resultNoFfmpegMode(outputResult)) {
    cliLog(`[publish:warning] [mode:no-ffmpeg] [message:本次发布产物未经 ffprobe 可播检测] [files:${publishedArtifacts.length}]`);
  }
  const remotePublishConfig = loadRemotePublishConfig(args);
  const remotePublishResults = await publishRemoteArtifacts(publishedArtifacts, remotePublishConfig, (line) => {
    if (!args.quiet) cliLog(line);
    else writeRuntimeLog(`${logTimestamp()} ${line}`);
  });
  const remotePublishFailed = remotePublishConfig?.failOnRemoteError && remotePublishResults.some((item) => !item.ok);
  if (remotePublishResults.length > 0 && outputResult.output) {
    outputResult.output.remotePublish = remotePublishResults;
    writeFileSync(out, args.compact ? JSON.stringify(outputResult) : JSON.stringify(outputResult, null, 2), 'utf8');
  }
  if (!args.quiet) {
    cliLog(`[wrote:json] [file:${out}]`);
    if (sourceStatsOut) cliLog(`[wrote:md] [type:source-stats] [file:${sourceStatsOut}]`);
    if (channelStatsOut) cliLog(`[wrote:md] [type:channel-stats] [file:${channelStatsOut}]`);
    for (const liveExport of liveExports) {
      cliLog(`[wrote:live] [format:${liveExport.format}] [entries:${liveExport.entries.length}] [file:${liveExport.file}]`);
    }
    if (publishedArtifacts.length) {
      cliLog(`[publish:matched] [dir:${resolve(DEFAULT_PUBLISH_DIR)}] [files:${publishedArtifacts.length}]`);
      for (const item of publishedArtifacts) {
        cliLog(`[publish:copy] [type:${item.type}] [from:${item.source}] [to:${item.target}]`);
      }
    }
    for (const item of remotePublishResults) {
      cliLog(`[remote-publish:${item.type}] [name:${item.name}] [files:${item.files}] [ok:${item.ok}]${item.status ? ` [status:${item.status}]` : ''}${item.error ? ` [error:${item.error}]` : ''}`);
    }
    cliLog(`[output] [entries:${outputResult.entries.length}/${result.entries.length}]`);
  }
  flushRuntimeLog();
  if (remotePublishFailed) {
    throw new Error('Remote publish failed. Check output.remotePublish or runtime log for details.');
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  cliError(`[error] ${msg}`);
  flushRuntimeLog();
  process.exit(1);
});


