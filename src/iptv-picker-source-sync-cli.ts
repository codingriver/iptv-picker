#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { githubRequestUrls, unwrapGithubAcceleratedUrl } from './core/config';
import { extractTvboxLiveSources, isLikelyLivePlaylistUrl } from './core/tvbox-live-extract';

type CatalogType = 'html_links' | 'text_links' | 'github_tree' | 'static_links' | 'embedded_m3u_pages' | 'tvbox_config_links' | 'generated_token_links';

interface StaticCatalogLink {
  name?: string;
  url: string;
  note?: string;
}

interface SourceCatalogConfig {
  key: string;
  name: string;
  enabled?: boolean;
  type: CatalogType;
  homepage: string;
  baseUrl?: string;
  generateUrl?: string;
  githubRepo?: string;
  githubRef?: string;
  githubPaths?: string[];
  githubRequestDelayMs?: number;
  githubRetry?: number;
  githubRetryDelayMs?: number;
  links?: Array<string | StaticCatalogLink>;
  fallbackLinks?: Array<string | StaticCatalogLink>;
  includePatterns?: string[];
  excludePatterns?: string[];
  preferPatterns?: string[];
  namePrefix?: string;
  sourceKind?: string;
  repo?: string;
  risk?: string;
  maxSources?: number;
  notes?: string;
}

interface CatalogFile {
  schemaVersion?: number;
  generatedAt?: string;
  purpose?: string;
  catalogs?: SourceCatalogConfig[];
}

interface CliArgs {
  config: string;
  out: string;
  report: string;
  githubCache: string;
  tokenCache: string;
  githubRequestDelayMs: number;
  githubRetry: number;
  githubRetryDelayMs: number;
  githubCacheEnabled: boolean;
  tokenCacheEnabled: boolean;
  only?: string[];
  dryRun: boolean;
  check: boolean;
  replaceCatalog: boolean;
  init: boolean;
  print: boolean;
  quiet: boolean;
  help: boolean;
}

interface DiscoveredSource {
  name: string;
  url: string;
  sourceKind: string;
  catalogKey: string;
  catalogName: string;
  format: 'm3u' | 'diyp_txt';
  repo?: string;
  risk?: string;
  note?: string;
  upstreamPath?: string;
  content?: string;
  sourceConfigName?: string;
  sourceConfigUrl?: string;
  liveName?: string;
  liveType?: number;
  ua?: string;
  stableKey?: string;
  httpStatusAtDiscovery?: number | string;
  importRecommendation?: string;
}

interface RawDiscoveredLink {
  url: string;
  name?: string;
  note?: string;
  upstreamPath?: string;
  content?: string;
  sourceKind?: string;
  sourceConfigName?: string;
  sourceConfigUrl?: string;
  liveName?: string;
  liveType?: number;
  ua?: string;
  stableKey?: string;
}

interface CatalogSyncRow {
  catalogKey: string;
  catalogName: string;
  discovered: number;
  kept: number;
  added: number;
  skippedDuplicate: number;
  skippedFailedCheck: number;
  replacedExisting: number;
  updatedExisting: number;
  messages: string[];
  warnings: string[];
  errors: string[];
}

interface CatalogReportMeta {
  totalCatalogs: number;
  enabledCatalogs: number;
  disabledCatalogs: number;
  selectedCatalogs: number;
  selectionMode: string;
  disabledCatalogKeys: string[];
  githubCachePath: string;
  githubCacheEnabled: boolean;
  githubTokenEnabled: boolean;
  githubRequestDelayMs: number;
  githubRetry: number;
  githubRetryDelayMs: number;
  tokenCachePath: string;
  tokenCacheEnabled: boolean;
}

const DEFAULT_CONFIG_PATH = 'data/source-catalogs.json';
const DEFAULT_OUTPUT_PATH = 'data/source.json';
const DEFAULT_REPORT_PATH = 'res/iptv-picker-source-sync.report.md';
const DEFAULT_GITHUB_CACHE_PATH = 'data/cache/source-catalog-cache.json';
const DEFAULT_TOKEN_CACHE_PATH = 'data/cache/source-token-cache.json';
const DEFAULT_GITHUB_REQUEST_DELAY_MS = 1000;
const DEFAULT_GITHUB_RETRY = 2;
const DEFAULT_GITHUB_RETRY_DELAY_MS = 3000;

interface GithubTreeCacheEntry {
  updatedAt: string;
  apiUrl: string;
  links: RawDiscoveredLink[];
}

interface GithubTreeCacheFile {
  schemaVersion?: number;
  generatedAt?: string;
  entries?: Record<string, GithubTreeCacheEntry>;
}

interface RuntimeContext {
  githubCachePath: string;
  githubCacheEnabled: boolean;
  githubCache: GithubTreeCacheFile;
  githubCacheDirty: boolean;
  githubRequestDelayMs: number;
  githubRetry: number;
  githubRetryDelayMs: number;
  tokenCachePath: string;
  tokenCacheEnabled: boolean;
  tokenCache: TokenCacheFile;
  tokenCacheDirty: boolean;
}

interface TokenCacheSource {
  stableKey: string;
  name: string;
  url: string;
  format: 'm3u' | 'diyp_txt';
  checkedAt?: string;
}

interface TokenCacheEntry {
  generateUrl: string;
  generatedAt: string;
  token?: string;
  sources: TokenCacheSource[];
}

interface TokenCacheFile {
  schemaVersion?: number;
  updatedAt?: string;
  entries?: Record<string, TokenCacheEntry>;
}

function defaultCatalogFile(): CatalogFile {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    purpose: 'Catalog definitions for discovering public IPTV M3U/TXT source lists and merging them into data/source.json.',
    catalogs: [
      {
        key: 'ibert',
        name: '董大直播源',
        enabled: true,
        type: 'html_links',
        homepage: 'https://m3u.ibert.me/',
        baseUrl: 'https://m3u.ibert.me/',
        includePatterns: ['\\.m3u$', '\\.txt$'],
        excludePatterns: ['^https?://(?!m3u\\.ibert\\.me/)', '/assets/', 'epg', '\\.xml$'],
        preferPatterns: ['/cn', '/o_cn', '/o_s_cn', '/txt/cn', '/txt/o_cn', '/txt/o_s_cn', '/fmml', '/ycl', '/j_iptv'],
        namePrefix: 'ibert',
        sourceKind: 'catalog',
        repo: 'HerbertHe/iptv-sources',
        risk: 'medium',
        maxSources: 30,
      },
      {
        key: 'publiciptv-cn',
        name: 'Public IPTV 中国大陆',
        enabled: true,
        type: 'embedded_m3u_pages',
        homepage: 'https://publiciptv.com/countries/cn',
        links: [
          {
            name: 'China',
            url: 'https://publiciptv.com/countries/cn/m3u',
            note: 'Public IPTV 中国大陆页面内嵌 M3U，自动提取页面中的 #EXTM3U 内容。',
          },
        ],
        includePatterns: ['countries/cn/m3u'],
        excludePatterns: ['countries/(hk|tw|mo)/'],
        namePrefix: 'Public IPTV',
        sourceKind: 'catalog',
        repo: 'publiciptv.com',
        risk: 'medium',
        maxSources: 5,
      },
      {
        key: 'cqshushu-token',
        name: 'IPTV神器Pro token接口',
        enabled: true,
        type: 'generated_token_links',
        homepage: 'https://iptv.cqshushu.com/jiekou.php',
        generateUrl: 'https://iptv.cqshushu.com/jiekou.php?action=generate',
        includePatterns: ['jiekou\\.php\\?jk=m3u&token='],
        excludePatterns: [],
        namePrefix: 'cqshushu',
        sourceKind: 'generated_token',
        repo: 'iptv.cqshushu.com',
        risk: 'medium',
        maxSources: 1,
        notes: '同步器会优先验证并复用 data/cache/source-token-cache.json 中缓存的 jk=m3u token 链接；缓存失效时重新访问 generateUrl 生成新 token。',
      },
    ],
  };
}

function usage(): string {
  return [
    'Usage:',
    '  node dist/iptv-picker-source-sync-cli.js',
    '  node dist/iptv-picker-source-sync-cli.js --k ibert',
    '',
    'Options:',
    `  --c, --config <file>       catalog config, default: ${DEFAULT_CONFIG_PATH}`,
    `  --o, --out <file>          merged source output, default: ${DEFAULT_OUTPUT_PATH}`,
    `  --rp, --report <file>      sync report, default: ${DEFAULT_REPORT_PATH}`,
    `  --gc, --github-cache <file> GitHub tree cache, default: ${DEFAULT_GITHUB_CACHE_PATH}`,
    `  --tc, --token-cache <file>  generated token cache, default: ${DEFAULT_TOKEN_CACHE_PATH}`,
    '  --k, --key <key[,key]>     only sync specific catalog key(s)',
    '  --n, --dry                preview only, do not write files',
    '  --nc, --no-check          skip HTTP validation for discovered playlist URLs',
    '  --r, --replace            remove old entries from the same catalog before merging',
    `  --gd, --github-delay <ms>  delay before GitHub API requests, default: ${DEFAULT_GITHUB_REQUEST_DELAY_MS}`,
    `  --gr, --github-retry <n>   GitHub API retry count on 403/429/5xx, default: ${DEFAULT_GITHUB_RETRY}`,
    `  --grd, --github-retry-delay <ms> base retry delay, default: ${DEFAULT_GITHUB_RETRY_DELAY_MS}`,
    '  --ngc, --no-github-cache   do not read/write GitHub tree cache',
    '  --ntc, --no-token-cache     do not read/write generated token cache',
    '  --init                    create default catalog config and exit',
    '  --p, --print              print JSON summary',
    '  --q, --quiet              suppress progress logs',
  ].join('\n');
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    config: DEFAULT_CONFIG_PATH,
    out: DEFAULT_OUTPUT_PATH,
    report: DEFAULT_REPORT_PATH,
    githubCache: DEFAULT_GITHUB_CACHE_PATH,
    tokenCache: DEFAULT_TOKEN_CACHE_PATH,
    githubRequestDelayMs: DEFAULT_GITHUB_REQUEST_DELAY_MS,
    githubRetry: DEFAULT_GITHUB_RETRY,
    githubRetryDelayMs: DEFAULT_GITHUB_RETRY_DELAY_MS,
    githubCacheEnabled: true,
    tokenCacheEnabled: true,
    dryRun: false,
    check: true,
    replaceCatalog: false,
    init: false,
    print: false,
    quiet: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item === '--help' || item === '-h') args.help = true;
    else if (item === '--c' || item === '--config') args.config = argv[++i];
    else if (item === '--o' || item === '--out') args.out = argv[++i];
    else if (item === '--rp' || item === '--report') args.report = argv[++i];
    else if (item === '--gc' || item === '--github-cache') args.githubCache = argv[++i];
    else if (item === '--tc' || item === '--token-cache') args.tokenCache = argv[++i];
    else if (item === '--k' || item === '--key') args.only = argv[++i].split(',').map((value) => value.trim()).filter(Boolean);
    else if (item === '--n' || item === '--dry' || item === '--dry-run') args.dryRun = true;
    else if (item === '--nc' || item === '--no-check') args.check = false;
    else if (item === '--r' || item === '--replace') args.replaceCatalog = true;
    else if (item === '--gd' || item === '--github-delay') args.githubRequestDelayMs = Number(argv[++i]);
    else if (item === '--gr' || item === '--github-retry') args.githubRetry = Number(argv[++i]);
    else if (item === '--grd' || item === '--github-retry-delay') args.githubRetryDelayMs = Number(argv[++i]);
    else if (item === '--ngc' || item === '--no-github-cache') args.githubCacheEnabled = false;
    else if (item === '--ntc' || item === '--no-token-cache') args.tokenCacheEnabled = false;
    else if (item === '--init') args.init = true;
    else if (item === '--p' || item === '--print') args.print = true;
    else if (item === '--q' || item === '--quiet') args.quiet = true;
    else throw new Error(`Unknown argument: ${item}`);
  }

  if (!Number.isFinite(args.githubRequestDelayMs) || args.githubRequestDelayMs < 0) throw new Error('--github-delay must be a non-negative number.');
  if (!Number.isFinite(args.githubRetry) || args.githubRetry < 0) throw new Error('--github-retry must be a non-negative number.');
  if (!Number.isFinite(args.githubRetryDelayMs) || args.githubRetryDelayMs < 0) throw new Error('--github-retry-delay must be a non-negative number.');

  return args;
}

function ensureDefaultCatalogFile(filePath: string): void {
  if (existsSync(filePath)) return;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(defaultCatalogFile(), null, 2), 'utf8');
}

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {
      generatedAt: new Date().toISOString(),
      purpose: 'Live quality source list.',
      notes: [],
      sources: [],
    };
  }
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function readGithubCache(filePath: string, enabled: boolean): GithubTreeCacheFile {
  if (!enabled || !existsSync(filePath)) return { schemaVersion: 1, generatedAt: new Date().toISOString(), entries: {} };
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as GithubTreeCacheFile;
    return { schemaVersion: 1, generatedAt: parsed.generatedAt, entries: parsed.entries || {} };
  } catch {
    return { schemaVersion: 1, generatedAt: new Date().toISOString(), entries: {} };
  }
}

function writeGithubCache(filePath: string, cache: GithubTreeCacheFile): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    entries: cache.entries || {},
  }, null, 2), 'utf8');
}

function readTokenCache(filePath: string, enabled: boolean): TokenCacheFile {
  if (!enabled || !existsSync(filePath)) return { schemaVersion: 1, updatedAt: new Date().toISOString(), entries: {} };
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as TokenCacheFile;
    return { schemaVersion: 1, updatedAt: parsed.updatedAt, entries: parsed.entries || {} };
  } catch {
    return { schemaVersion: 1, updatedAt: new Date().toISOString(), entries: {} };
  }
}

function writeTokenCache(filePath: string, cache: TokenCacheFile): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    entries: cache.entries || {},
  }, null, 2), 'utf8');
}

function githubToken(): string | undefined {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return token && token.trim() ? token.trim() : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function headerNumber(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function githubRetryDelayMs(response: Response, fallbackMs: number, attempt: number): number {
  const retryAfter = headerNumber(response.headers, 'retry-after');
  if (retryAfter && retryAfter > 0) return retryAfter * 1000;

  const remaining = headerNumber(response.headers, 'x-ratelimit-remaining');
  const reset = headerNumber(response.headers, 'x-ratelimit-reset');
  if (remaining === 0 && reset && reset > 0) {
    const waitMs = reset * 1000 - Date.now() + 1000;
    if (waitMs > 0) return waitMs;
  }

  return fallbackMs * Math.max(1, attempt + 1);
}

function compilePatterns(patterns?: string[]): RegExp[] {
  return (patterns || []).map((pattern) => new RegExp(pattern, 'i'));
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function searchableLinkText(link: RawDiscoveredLink): string {
  return [link.url, link.name, link.upstreamPath].filter(Boolean).join(' ');
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values));
}

function uniqueLinks(values: RawDiscoveredLink[]): RawDiscoveredLink[] {
  const seen = new Set<string>();
  const result: RawDiscoveredLink[] = [];
  for (const value of values) {
    const key = value.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function normalizeUrl(href: string, baseUrl: string): string | undefined {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('mailto:') || trimmed.startsWith('javascript:')) return undefined;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function extractHtmlLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const linkRe = /href\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html)) !== null) {
    const url = normalizeUrl(match[1], baseUrl);
    if (url) links.push(url);
  }
  return uniqueValues(links);
}

function cleanExtractedUrl(value: string): string {
  return value
    .replace(/[),.，。;；]+$/g, '')
    .replace(/&amp;/g, '&')
    .trim();
}

function unwrapKnownUrl(value: string): string {
  let url = cleanExtractedUrl(value);
  const addPrefix = 'https://add.aptv.app/';
  if (url.startsWith(addPrefix)) url = url.slice(addPrefix.length);
  return unwrapGithubAcceleratedUrl(url);
}

function extractTextLinks(text: string, baseUrl: string): RawDiscoveredLink[] {
  const links: RawDiscoveredLink[] = [];
  const push = (value: string, name?: string) => {
    const unwrapped = unwrapKnownUrl(value);
    const url = normalizeUrl(unwrapped, baseUrl);
    if (url) links.push({ url, name });
  };

  const hrefRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(text)) !== null) {
    push(match[1]);
  }

  const markdownRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
  while ((match = markdownRe.exec(text)) !== null) {
    push(match[2]);
  }

  const urlRe = /https?:\/\/[^\s"'<>）)]+/gi;
  while ((match = urlRe.exec(text)) !== null) {
    push(match[0]);
  }

  return uniqueLinks(links);
}

async function extractTextPageLinks(catalog: SourceCatalogConfig): Promise<{ links: RawDiscoveredLink[]; errors: string[] }> {
  const errors: string[] = [];
  try {
    const fetched = await fetchText(catalog.homepage, 15000);
    if (fetched.status < 200 || fetched.status >= 400) {
      return { links: [], errors: [`Homepage HTTP ${fetched.status}: ${catalog.homepage}`] };
    }
    return { links: extractTextLinks(fetched.text, catalog.baseUrl || catalog.homepage), errors };
  } catch (error) {
    errors.push(`Homepage fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    return { links: [], errors };
  }
}

function tvboxWarningLabel(code: string, message: string): string {
  if (code === 'MISSING_LIVE_URL') return '缺少 live URL';
  if (code === 'NO_LIVES') return '未找到 lives[]';
  if (code === 'NO_SUPPORTED_LIVE_CANDIDATE') return '未找到支持的直播候选';
  if (code === 'UNSUPPORTED_LIVE_URL') return '不支持的 live URL';
  return message || code;
}

function summarizeTvboxWarnings(warnings: Array<{ configName: string; path: string; message: string; code?: string }>): string[] {
  const byCode = new Map<string, { label: string; count: number }>();
  for (const warning of warnings) {
    const code = warning.code || warning.message;
    const current = byCode.get(code);
    if (current) {
      current.count++;
    } else {
      byCode.set(code, { label: tvboxWarningLabel(code, warning.message), count: 1 });
    }
  }

  return Array.from(byCode.values()).map((item) => `${item.label}: ${item.count} 条`);
}

function tvboxErrorLabel(warning: { message: string; code?: string }): string {
  const status = warning.message.match(/\bHTTP\s+(\d{3})\b/i)?.[1];
  if (status) return `HTTP ${status}`;
  if (warning.code === 'CONFIG_DOWNLOAD_OR_PARSE_FAILED') return '下载或解析失败';
  return warning.message || warning.code || '未知错误';
}

function summarizeTvboxErrors(errors: Array<{ message: string; code?: string }>): string[] {
  const byLabel = new Map<string, number>();
  for (const error of errors) {
    const label = tvboxErrorLabel(error);
    byLabel.set(label, (byLabel.get(label) || 0) + 1);
  }
  return Array.from(byLabel.entries()).map(([label, count]) => `${label}: ${count} 条`);
}

async function extractTvboxConfigLiveLinks(catalog: SourceCatalogConfig): Promise<{ links: RawDiscoveredLink[]; errors: string[]; warnings: string[]; discoveredConfigs: number }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let configLinks: RawDiscoveredLink[] = [];
  if (catalog.links && catalog.links.length) {
    configLinks = staticCatalogLinks(catalog);
  } else {
    const result = await extractTextPageLinks(catalog);
    configLinks = result.links;
    errors.push(...result.errors);
  }

  const includePatterns = compilePatterns(catalog.includePatterns);
  const excludePatterns = compilePatterns(catalog.excludePatterns);
  const keptConfigs = uniqueLinks(configLinks)
    .filter((link) => includePatterns.length === 0 || matchesAny(searchableLinkText(link), includePatterns))
    .filter((link) => !matchesAny(searchableLinkText(link), excludePatterns));

  const extracted = await extractTvboxLiveSources(keptConfigs.map((link) => ({
    name: link.name || titleFromUrl(catalog.namePrefix || catalog.name || catalog.key, link.url, 'm3u'),
    url: link.url,
  })));
  const warningItems = extracted.warnings.filter((warning) => warning.severity !== 'error');
  const errorItems = extracted.warnings.filter((warning) => warning.severity === 'error');
  warnings.push(...summarizeTvboxWarnings(warningItems));
  errors.push(...summarizeTvboxErrors(errorItems));

  const links = extracted.sources
    .filter((source) => source.content || isLikelyLivePlaylistUrl(source.url))
    .map((source) => ({
      name: source.name,
      url: source.url,
      content: source.content,
      sourceKind: source.sourceKind,
      sourceConfigName: source.sourceConfigName,
      sourceConfigUrl: source.sourceConfigUrl,
      liveName: source.liveName,
      liveType: source.liveType,
      ua: source.ua,
      note: source.notes || `从 TVBox 配置 ${source.sourceConfigName} 的 lives[] 提取。`,
      upstreamPath: source.sourceConfigUrl,
    }));

  return { links: uniqueLinks(links), errors, warnings, discoveredConfigs: keptConfigs.length };
}

function tokenFromGeneratedUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('token') || undefined;
  } catch {
    return undefined;
  }
}

function normalizeGeneratedTokenUrl(value: string): string | undefined {
  const decoded = decodeHtmlEntities(value);
  try {
    const parsed = new URL(decoded);
    if (!/iptv\.cqshushu\.com$/i.test(parsed.hostname)) return undefined;
    if (parsed.pathname !== '/jiekou.php') return undefined;
    const jk = parsed.searchParams.get('jk');
    const token = parsed.searchParams.get('token');
    if (!jk || !/^m3u$/i.test(jk) || !token) return undefined;
    return `http://iptv.cqshushu.com/jiekou.php?jk=m3u&token=${token}`;
  } catch {
    return undefined;
  }
}

function extractGeneratedTokenUrls(html: string): string[] {
  const urls: string[] = [];
  const urlRe = /https?:\/\/[^\s"'<>）)]+/gi;
  let match: RegExpExecArray | null;
  while ((match = urlRe.exec(html)) !== null) {
    const normalized = normalizeGeneratedTokenUrl(cleanExtractedUrl(match[0]));
    if (normalized) urls.push(normalized);
  }
  return uniqueValues(urls);
}

function generatedTokenSourceFromUrl(catalog: SourceCatalogConfig, url: string): RawDiscoveredLink {
  const parsed = new URL(url);
  const jk = (parsed.searchParams.get('jk') || 'm3u').toLowerCase();
  return {
    name: `${catalog.namePrefix || catalog.name || catalog.key} jiekou ${jk.toUpperCase()}`,
    url,
    stableKey: `jiekou-${jk}`,
    sourceKind: catalog.sourceKind || 'generated_token',
    note: `从 ${catalog.name} 生成的带 token 直播源入口。`,
  };
}

async function fetchSmallText(url: string, timeoutMs: number): Promise<{ status: number; text: string; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 iptv-picker-source-sync', range: 'bytes=0-8191' },
    });
    return {
      status: response.status,
      text: await response.text(),
      contentType: response.headers.get('content-type') || '',
    };
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeValidGeneratedSource(url: string, text: string, contentType: string, status: number): boolean {
  if (status < 200 || status >= 400) return false;
  const lower = text.toLowerCase();
  if (/<html\b/i.test(text) || lower.includes('token') && /无效|失效|过期|错误|授权失败/.test(text)) return false;
  const parsed = new URL(url);
  const jk = (parsed.searchParams.get('jk') || '').toLowerCase();
  if (jk === 'json') {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return /application\/json/i.test(contentType) && !/<html\b/i.test(text);
    }
  }
  if (jk === 'txt') {
    return text.includes('#genre#') || /^.{1,80},\s*(https?|rtsp?|rtp|udp):\/\//im.test(text);
  }
  return text.includes('#EXTM3U') || text.includes('#EXTINF');
}

async function cachedGeneratedTokenLinks(catalog: SourceCatalogConfig, context: RuntimeContext): Promise<RawDiscoveredLink[] | undefined> {
  if (!context.tokenCacheEnabled) return undefined;
  const entry = context.tokenCache.entries?.[catalog.key];
  if (!entry || !Array.isArray(entry.sources) || entry.sources.length === 0) return undefined;
  const first = entry.sources[0];
  try {
    const checked = await fetchSmallText(first.url, 10000);
    if (!looksLikeValidGeneratedSource(first.url, checked.text, checked.contentType, checked.status)) return undefined;
  } catch {
    return undefined;
  }
  return entry.sources.map((source) => ({
    name: source.name,
    url: source.url,
    stableKey: source.stableKey,
    sourceKind: catalog.sourceKind || 'generated_token',
    note: `从 ${catalog.name} 缓存的带 token 直播源入口。`,
  }));
}

async function extractGeneratedTokenLinks(catalog: SourceCatalogConfig, context: RuntimeContext): Promise<{ links: RawDiscoveredLink[]; errors: string[]; messages: string[] }> {
  const errors: string[] = [];
  const messages: string[] = [];
  const cached = await cachedGeneratedTokenLinks(catalog, context);
  if (cached && cached.length) {
    messages.push(`使用缓存 token 链接：${cached.map((link) => link.url).join('<br>')}`);
    return { links: cached, errors, messages };
  }
  messages.push('未找到可用缓存 token，准备调用生成接口。');

  const generateUrl = catalog.generateUrl || catalog.homepage;
  try {
    let fetched = await fetchText(generateUrl, 15000);
    for (let attempt = 0; fetched.status === 429 && attempt < 2; attempt++) {
      const delayMs = 3000 * (attempt + 1);
      messages.push(`生成接口返回 429，等待 ${delayMs}ms 后重试：${generateUrl}`);
      await sleep(delayMs);
      fetched = await fetchText(generateUrl, 15000);
    }
    if (fetched.status < 200 || fetched.status >= 400) {
      messages.push(`生成接口调用失败，已跳过当前订阅源：${catalog.name}`);
      errors.push(`Generate HTTP ${fetched.status}: ${generateUrl}`);
      return { links: [], errors, messages };
    }
    const urls = extractGeneratedTokenUrls(fetched.text);
    const links = urls.map((url) => generatedTokenSourceFromUrl(catalog, url));
    if (links.length === 0) {
      messages.push(`生成接口未返回可用 M3U token 链接，已跳过当前订阅源：${catalog.name}`);
      errors.push(`No generated jiekou.php?jk=m3u token link found: ${generateUrl}`);
      return { links: [], errors, messages };
    }

    const token = tokenFromGeneratedUrl(links[0].url);
    if (context.tokenCacheEnabled) {
      if (!context.tokenCache.entries) context.tokenCache.entries = {};
      context.tokenCache.entries[catalog.key] = {
        generateUrl,
        generatedAt: new Date().toISOString(),
        token,
        sources: links.map((link) => ({
          stableKey: link.stableKey || link.url,
          name: link.name || titleFromUrl(catalog.namePrefix || catalog.name || catalog.key, link.url, inferFormat(link.url)),
          url: link.url,
          format: inferFormat(link.url),
          checkedAt: new Date().toISOString(),
        })),
      };
      context.tokenCacheDirty = true;
    }
    messages.push(`重新生成 token 链接：${links.map((link) => link.url).join('<br>')}`);
    return { links, errors, messages };
  } catch (error) {
    messages.push(`生成接口调用异常，已跳过当前订阅源：${catalog.name}`);
    errors.push(`Generate failed: ${error instanceof Error ? error.message : String(error)} (${generateUrl})`);
    return { links: [], errors, messages };
  }
}

async function fetchGithubText(apiUrl: string, catalog: SourceCatalogConfig, context: RuntimeContext): Promise<{ status: number; text: string; response: Response }> {
  const requestDelayMs = catalog.githubRequestDelayMs ?? context.githubRequestDelayMs;
  const retry = catalog.githubRetry ?? context.githubRetry;
  const retryDelayMs = catalog.githubRetryDelayMs ?? context.githubRetryDelayMs;
  const token = githubToken();

  let lastResponse: Response | undefined;
  let lastText = '';
  const requestUrls = githubRequestUrls(apiUrl);
  for (let attempt = 0; attempt <= retry; attempt++) {
    for (const requestUrl of requestUrls) {
      if (requestDelayMs > 0) await sleep(requestDelayMs);

      const headers: Record<string, string> = {
        'user-agent': 'Mozilla/5.0 iptv-picker-source-sync',
        accept: 'application/vnd.github+json',
      };
      if (token && requestUrl === apiUrl) headers.authorization = `Bearer ${token}`;

      const response = await fetch(requestUrl, { headers });
      const text = await response.text();
      lastResponse = response;
      lastText = text;

      const retryable = response.status === 403 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= retry) return { status: response.status, text, response };
    }

    if (lastResponse) await sleep(githubRetryDelayMs(lastResponse, retryDelayMs, attempt));
  }

  if (!lastResponse) throw new Error('GitHub request did not run.');
  return { status: lastResponse.status, text: lastText, response: lastResponse };
}

function githubCacheKey(apiUrl: string): string {
  return apiUrl;
}

function readGithubCacheEntry(context: RuntimeContext, apiUrl: string): RawDiscoveredLink[] | undefined {
  if (!context.githubCacheEnabled) return undefined;
  const entry = context.githubCache.entries?.[githubCacheKey(apiUrl)];
  return entry && Array.isArray(entry.links) ? entry.links : undefined;
}

function writeGithubCacheEntry(context: RuntimeContext, apiUrl: string, links: RawDiscoveredLink[]): void {
  if (!context.githubCacheEnabled) return;
  if (!context.githubCache.entries) context.githubCache.entries = {};
  context.githubCache.entries[githubCacheKey(apiUrl)] = {
    updatedAt: new Date().toISOString(),
    apiUrl,
    links,
  };
  context.githubCacheDirty = true;
}

function fallbackCatalogLinks(catalog: SourceCatalogConfig): RawDiscoveredLink[] {
  return uniqueLinks((catalog.fallbackLinks || [])
    .map((item) => {
      if (typeof item === 'string') return { url: item };
      return { url: item.url, name: item.name, note: item.note };
    })
    .filter((item) => typeof item.url === 'string' && item.url.trim())
    .map((item) => ({ ...item, url: item.url.trim() })));
}

function parseGithubContentsLinks(text: string): RawDiscoveredLink[] {
  const parsed = JSON.parse(text) as unknown;
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const links: RawDiscoveredLink[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (record.type !== 'file') continue;
    const downloadUrl = typeof record.download_url === 'string' ? record.download_url : '';
    if (!downloadUrl) continue;
    const name = typeof record.name === 'string' ? record.name : undefined;
    const path = typeof record.path === 'string' ? record.path : undefined;
    links.push({ url: downloadUrl, name, upstreamPath: path });
  }
  return uniqueLinks(links);
}

async function extractGithubHtmlTreeLinks(repo: string, ref: string, rawPath: string): Promise<RawDiscoveredLink[]> {
  const cleanPath = rawPath.replace(/^\/+|\/+$/g, '');
  const treeUrl = `https://github.com/${repo}/tree/${encodeURIComponent(ref)}${cleanPath ? `/${cleanPath}` : ''}`;
  const fetched = await fetchText(treeUrl, 15000);
  if (fetched.status < 200 || fetched.status >= 400) return [];

  const links: RawDiscoveredLink[] = [];
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  const blobPrefix = `/${repo}/blob/${ref}/`;
  while ((match = hrefRe.exec(fetched.text)) !== null) {
    const href = decodeHtmlEntities(match[1]);
    let parsed: URL;
    try {
      parsed = new URL(href, 'https://github.com');
    } catch {
      continue;
    }
    const path = decodeURIComponent(parsed.pathname);
    if (!path.startsWith(blobPrefix)) continue;
    const upstreamPath = path.slice(blobPrefix.length);
    if (!upstreamPath || upstreamPath.endsWith('/')) continue;
    if (cleanPath && !upstreamPath.startsWith(`${cleanPath}/`)) continue;
    const rawUrl = `https://raw.githubusercontent.com/${repo}/${ref}/${upstreamPath.split('/').map(encodeURIComponent).join('/')}`;
    const name = upstreamPath.split('/').pop();
    links.push({ url: rawUrl, name, upstreamPath });
  }

  return uniqueLinks(links);
}

async function tryGithubHtmlTreeLinks(repo: string, ref: string, rawPath: string): Promise<RawDiscoveredLink[]> {
  try {
    return await extractGithubHtmlTreeLinks(repo, ref, rawPath);
  } catch {
    return [];
  }
}

async function extractGithubTreeLinks(catalog: SourceCatalogConfig, context: RuntimeContext): Promise<{ links: RawDiscoveredLink[]; errors: string[] }> {
  const errors: string[] = [];
  const links: RawDiscoveredLink[] = [];
  const repo = catalog.githubRepo || catalog.repo;
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
    return { links, errors: [`Invalid githubRepo: ${repo || '-'}`] };
  }
  const ref = encodeURIComponent(catalog.githubRef || 'main');
  const paths = catalog.githubPaths && catalog.githubPaths.length ? catalog.githubPaths : [''];
  for (const rawPath of paths) {
    const cleanPath = rawPath.replace(/^\/+|\/+$/g, '');
    const apiPath = cleanPath ? `/${cleanPath}` : '';
    const apiUrl = `https://api.github.com/repos/${repo}/contents${apiPath}?ref=${ref}`;
    try {
      const fetched = await fetchGithubText(apiUrl, catalog, context);
      if (fetched.status < 200 || fetched.status >= 400) {
        const htmlLinks = await tryGithubHtmlTreeLinks(repo, catalog.githubRef || 'main', rawPath);
        if (htmlLinks.length) {
          errors.push(`GitHub tree HTTP ${fetched.status}, used GitHub HTML fallback: ${apiUrl}`);
          writeGithubCacheEntry(context, apiUrl, htmlLinks);
          links.push(...htmlLinks);
          continue;
        }
        const cached = readGithubCacheEntry(context, apiUrl);
        if (cached && cached.length) {
          errors.push(`GitHub tree HTTP ${fetched.status}, used cache: ${apiUrl}`);
          links.push(...cached);
          continue;
        }
        const fallback = fallbackCatalogLinks(catalog);
        if (fallback.length) {
          errors.push(`GitHub tree HTTP ${fetched.status}, used fallbackLinks: ${apiUrl}`);
          links.push(...fallback);
          continue;
        }
        errors.push(`GitHub tree HTTP ${fetched.status}: ${apiUrl}`);
        continue;
      }
      const parsedLinks = parseGithubContentsLinks(fetched.text);
      writeGithubCacheEntry(context, apiUrl, parsedLinks);
      links.push(...parsedLinks);
    } catch (error) {
      const htmlLinks = await tryGithubHtmlTreeLinks(repo, catalog.githubRef || 'main', rawPath);
      if (htmlLinks.length) {
        errors.push(`GitHub tree fetch failed, used GitHub HTML fallback: ${error instanceof Error ? error.message : String(error)} (${apiUrl})`);
        writeGithubCacheEntry(context, apiUrl, htmlLinks);
        links.push(...htmlLinks);
        continue;
      }
      const cached = readGithubCacheEntry(context, apiUrl);
      if (cached && cached.length) {
        errors.push(`GitHub tree fetch failed, used cache: ${error instanceof Error ? error.message : String(error)} (${apiUrl})`);
        links.push(...cached);
        continue;
      }
      const fallback = fallbackCatalogLinks(catalog);
      if (fallback.length) {
        errors.push(`GitHub tree fetch failed, used fallbackLinks: ${error instanceof Error ? error.message : String(error)} (${apiUrl})`);
        links.push(...fallback);
        continue;
      }
      errors.push(`GitHub tree fetch failed: ${error instanceof Error ? error.message : String(error)} (${apiUrl})`);
    }
  }
  return { links: uniqueLinks(links), errors };
}

function staticCatalogLinks(catalog: SourceCatalogConfig): RawDiscoveredLink[] {
  return uniqueLinks((catalog.links || [])
    .map((item) => {
      if (typeof item === 'string') return { url: item };
      return { url: item.url, name: item.name, note: item.note };
    })
    .filter((item) => typeof item.url === 'string' && item.url.trim())
    .map((item) => ({ ...item, url: item.url.trim() })));
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
}

function extractEmbeddedM3u(html: string): string | undefined {
  const preMatch = html.match(/<pre\b[^>]*>([\s\S]*?#EXTM3U[\s\S]*?)<\/pre>/i);
  const raw = preMatch ? preMatch[1] : html.slice(html.indexOf('#EXTM3U'));
  if (!raw || !raw.includes('#EXTM3U')) return undefined;
  const text = decodeHtmlEntities(raw)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  const index = text.indexOf('#EXTM3U');
  if (index < 0) return undefined;
  return text.slice(index).trim() + '\n';
}

function scoreUrl(url: string, preferPatterns: RegExp[]): number {
  let score = 0;
  for (const pattern of preferPatterns) {
    if (pattern.test(url)) score += 100;
  }
  if (/\/txt\//i.test(url)) score += 10;
  if (/\.m3u$/i.test(url)) score += 8;
  return score;
}

function inferFormat(url: string): 'm3u' | 'diyp_txt' {
  return /\.txt$/i.test(url) ? 'diyp_txt' : 'm3u';
}

function titleFromUrl(prefix: string, url: string, format: 'm3u' | 'diyp_txt', preferredName?: string): string {
  if (preferredName && preferredName.trim()) {
    const suffix = format === 'diyp_txt' ? 'TXT' : 'M3U';
    return `${prefix} ${preferredName.replace(/\.(m3u8?|txt)$/i, '')} ${suffix}`.replace(/\s+/g, ' ').trim();
  }
  const parsed = new URL(url);
  const parts = parsed.pathname.split('/').filter(Boolean);
  const stem = (parts.join(' ') || parsed.hostname)
    .replace(/\.(m3u8?|txt)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const suffix = format === 'diyp_txt' ? 'TXT' : 'M3U';
  return `${prefix} ${stem} ${suffix}`.replace(/\s+/g, ' ').trim();
}

async function fetchText(url: string, timeoutMs: number): Promise<{ status: number; text: string }> {
  let lastError: unknown;
  let lastResult: { status: number; text: string } | undefined;
  const requestUrls = githubRequestUrls(url);
  for (const requestUrl of requestUrls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(requestUrl, {
        signal: controller.signal,
        headers: { 'user-agent': 'Mozilla/5.0 iptv-picker-source-sync' },
      });
      const text = await response.text();
      if (response.status >= 200 && response.status < 400) return { status: response.status, text };
      lastResult = { status: response.status, text };
      if (requestUrls.length === 1) return lastResult;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastResult) return lastResult;
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Fetch failed'));
}

async function checkUrl(url: string, timeoutMs: number): Promise<{ ok: boolean; status?: number; error?: string }> {
  let lastStatus: number | undefined;
  let lastError: string | undefined;
  for (const requestUrl of githubRequestUrls(url)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response = await fetch(requestUrl, {
        method: 'HEAD',
        signal: controller.signal,
        headers: { 'user-agent': 'Mozilla/5.0 iptv-picker-source-sync' },
      });
      if (response.status === 405 || response.status === 403) {
        response = await fetch(requestUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: { 'user-agent': 'Mozilla/5.0 iptv-picker-source-sync', range: 'bytes=0-2047' },
        });
      }
      if (response.status >= 200 && response.status < 400) return { ok: true, status: response.status };
      lastStatus = response.status;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: lastStatus, error: lastError };
}

async function discoverCatalog(catalog: SourceCatalogConfig, check: boolean, context: RuntimeContext): Promise<{ sources: DiscoveredSource[]; row: CatalogSyncRow }> {
  const row: CatalogSyncRow = {
    catalogKey: catalog.key,
    catalogName: catalog.name,
    discovered: 0,
    kept: 0,
    added: 0,
    skippedDuplicate: 0,
    skippedFailedCheck: 0,
    replacedExisting: 0,
    updatedExisting: 0,
    messages: [],
    warnings: [],
    errors: [],
  };

  if (!['html_links', 'text_links', 'github_tree', 'static_links', 'embedded_m3u_pages', 'tvbox_config_links', 'generated_token_links'].includes(catalog.type)) {
    row.errors.push(`Unsupported catalog type: ${catalog.type}`);
    return { sources: [], row };
  }

  let links: RawDiscoveredLink[] = [];
  if (catalog.type === 'html_links') {
    let html = '';
    try {
      const fetched = await fetchText(catalog.homepage, 15000);
      if (fetched.status < 200 || fetched.status >= 400) {
        row.errors.push(`Homepage HTTP ${fetched.status}: ${catalog.homepage}`);
        return { sources: [], row };
      }
      html = fetched.text;
    } catch (error) {
      row.errors.push(`Homepage fetch failed: ${error instanceof Error ? error.message : String(error)}`);
      return { sources: [], row };
    }
    const baseUrl = catalog.baseUrl || catalog.homepage;
    links = extractHtmlLinks(html, baseUrl).map((url) => ({ url }));
  } else if (catalog.type === 'text_links') {
    const result = await extractTextPageLinks(catalog);
    links = result.links;
    row.errors.push(...result.errors);
  } else if (catalog.type === 'github_tree') {
    const result = await extractGithubTreeLinks(catalog, context);
    links = result.links;
    row.errors.push(...result.errors);
  } else if (catalog.type === 'tvbox_config_links') {
    const result = await extractTvboxConfigLiveLinks(catalog);
    links = result.links;
    row.errors.push(...result.errors);
    row.warnings.push(...result.warnings);
    row.discovered = result.discoveredConfigs;
  } else if (catalog.type === 'generated_token_links') {
    const result = await extractGeneratedTokenLinks(catalog, context);
    links = result.links;
    row.errors.push(...result.errors);
    row.messages.push(...result.messages);
  } else {
    links = staticCatalogLinks(catalog);
  }

  const includePatterns = compilePatterns(catalog.includePatterns);
  const excludePatterns = compilePatterns(catalog.excludePatterns);
  const preferPatterns = compilePatterns(catalog.preferPatterns);
  if (row.discovered === 0) row.discovered = links.length;

  let kept = links
    .filter((link) => includePatterns.length === 0 || matchesAny(searchableLinkText(link), includePatterns))
    .filter((link) => !matchesAny(searchableLinkText(link), excludePatterns));
  kept = uniqueLinks(kept)
    .sort((a, b) => scoreUrl(b.url, preferPatterns) - scoreUrl(a.url, preferPatterns) || a.url.localeCompare(b.url));
  if (typeof catalog.maxSources === 'number' && catalog.maxSources > 0) kept = kept.slice(0, catalog.maxSources);
  row.kept = kept.length;

  const sources: DiscoveredSource[] = [];
  for (const link of kept) {
    const url = link.url;
    const format = inferFormat(url);
    const source: DiscoveredSource = {
      name: link.sourceKind === 'generated_token' && link.name
        ? link.name
        : titleFromUrl(catalog.namePrefix || catalog.name || catalog.key, url, format, link.name),
      url,
      sourceKind: catalog.sourceKind || 'catalog',
      ...(link.sourceKind ? { sourceKind: link.sourceKind } : {}),
      catalogKey: catalog.key,
      catalogName: catalog.name,
      format,
      repo: catalog.repo,
      risk: catalog.risk,
      note: link.note || `从聚合源目录 ${catalog.name} 自动同步。`,
      upstreamPath: link.upstreamPath,
      content: link.content,
      sourceConfigName: link.sourceConfigName,
      sourceConfigUrl: link.sourceConfigUrl,
      liveName: link.liveName,
      liveType: link.liveType,
      ua: link.ua,
      stableKey: link.stableKey,
    };
    if (check) {
      if (source.content && !/^https?:\/\//i.test(url)) {
        source.httpStatusAtDiscovery = 'inline_content';
        source.importRecommendation = 'auto_import';
      } else if (catalog.type === 'embedded_m3u_pages') {
        try {
          const fetched = await fetchText(url, 15000);
          source.httpStatusAtDiscovery = fetched.status;
          const content = fetched.status >= 200 && fetched.status < 400 ? extractEmbeddedM3u(fetched.text) : undefined;
          if (!content) {
            source.importRecommendation = 'skip_failed_check';
            row.skippedFailedCheck++;
            continue;
          }
          source.content = content;
          source.importRecommendation = 'auto_import';
        } catch (error) {
          source.httpStatusAtDiscovery = error instanceof Error ? error.message : String(error);
          source.importRecommendation = 'skip_failed_check';
          row.skippedFailedCheck++;
          continue;
        }
      } else {
        const checked = await checkUrl(url, 10000);
        source.httpStatusAtDiscovery = checked.status || checked.error || 'unknown';
        source.importRecommendation = checked.ok ? 'auto_import' : 'skip_failed_check';
        if (!checked.ok) {
          row.skippedFailedCheck++;
          continue;
        }
      }
    } else {
      if (catalog.type === 'embedded_m3u_pages') {
        try {
          const fetched = await fetchText(url, 15000);
          source.httpStatusAtDiscovery = fetched.status;
          source.content = extractEmbeddedM3u(fetched.text);
        } catch (error) {
          source.httpStatusAtDiscovery = error instanceof Error ? error.message : String(error);
        }
      }
      source.importRecommendation = 'auto_import_unchecked';
    }
    sources.push(source);
  }

  return { sources, row };
}

function mergeSources(
  existing: Record<string, unknown>,
  discovered: DiscoveredSource[],
  replaceCatalog: boolean,
): {
  output: Record<string, unknown>;
  added: number;
  skippedDuplicate: number;
  replacedExisting: number;
  updatedExisting: number;
  replacedExistingByCatalog: Record<string, number>;
  addedByCatalog: Record<string, number>;
  skippedDuplicateByCatalog: Record<string, number>;
  updatedExistingByCatalog: Record<string, number>;
} {
  const currentSources = Array.isArray(existing.sources)
    ? existing.sources as Array<Record<string, unknown>>
    : [];
  const replaceKeys = new Set(discovered.map((source) => source.catalogKey));
  const replacedExistingByCatalog: Record<string, number> = {};
  const retained = replaceCatalog
    ? currentSources.filter((source) => {
      const catalogKey = typeof source.catalogKey === 'string' ? source.catalogKey : '';
      const replaced = catalogKey && replaceKeys.has(catalogKey);
      if (replaced) replacedExistingByCatalog[catalogKey] = (replacedExistingByCatalog[catalogKey] || 0) + 1;
      return !replaced;
    })
    : currentSources.slice();
  const replacedExisting = currentSources.length - retained.length;
  const seen = new Set(retained
    .map((source) => typeof source.url === 'string' ? source.url.toLowerCase() : '')
    .filter(Boolean));
  const stableIndex = new Map<string, number>();
  for (let index = 0; index < retained.length; index++) {
    const source = retained[index];
    const catalogKey = typeof source.catalogKey === 'string' ? source.catalogKey : '';
    const stableKey = typeof source.stableKey === 'string' ? source.stableKey : '';
    if (catalogKey && stableKey) stableIndex.set(`${catalogKey}::${stableKey}`, index);
  }

  let added = 0;
  let skippedDuplicate = 0;
  let updatedExisting = 0;
  const addedByCatalog: Record<string, number> = {};
  const skippedDuplicateByCatalog: Record<string, number> = {};
  const updatedExistingByCatalog: Record<string, number> = {};
  const sources = retained.slice();
  for (const source of discovered) {
    const key = source.url.toLowerCase();
    const stableMergeKey = source.stableKey ? `${source.catalogKey}::${source.stableKey}` : '';
    const stableMergeIndex = stableMergeKey ? stableIndex.get(stableMergeKey) : undefined;
    if (typeof stableMergeIndex === 'number') {
      const oldUrl = typeof sources[stableMergeIndex].url === 'string' ? sources[stableMergeIndex].url.toLowerCase() : '';
      if (oldUrl) seen.delete(oldUrl);
      sources[stableMergeIndex] = { ...source };
      seen.add(key);
      updatedExisting++;
      updatedExistingByCatalog[source.catalogKey] = (updatedExistingByCatalog[source.catalogKey] || 0) + 1;
      continue;
    }
    if (seen.has(key)) {
      skippedDuplicate++;
      skippedDuplicateByCatalog[source.catalogKey] = (skippedDuplicateByCatalog[source.catalogKey] || 0) + 1;
      continue;
    }
    sources.push({ ...source });
    seen.add(key);
    if (stableMergeKey) stableIndex.set(stableMergeKey, sources.length - 1);
    added++;
    addedByCatalog[source.catalogKey] = (addedByCatalog[source.catalogKey] || 0) + 1;
  }

  const notes = Array.isArray(existing.notes) ? existing.notes.slice() : [];
  const note = 'Catalog source entries were discovered and merged by iptv-picker-source-sync.';
  if (!notes.includes(note)) notes.push(note);

  return {
    output: {
      ...existing,
      generatedAt: new Date().toISOString(),
      purpose: typeof existing.purpose === 'string' ? existing.purpose : 'Live quality source list.',
      notes,
      sources,
    },
    added,
    skippedDuplicate,
    replacedExisting,
    updatedExisting,
    replacedExistingByCatalog,
    addedByCatalog,
    skippedDuplicateByCatalog,
    updatedExistingByCatalog,
  };
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function markdownReport(rows: CatalogSyncRow[], out: string, dryRun: boolean, meta: CatalogReportMeta): string {
  const totals = rows.reduce((acc, row) => ({
    discovered: acc.discovered + row.discovered,
    kept: acc.kept + row.kept,
    added: acc.added + row.added,
    skippedDuplicate: acc.skippedDuplicate + row.skippedDuplicate,
    skippedFailedCheck: acc.skippedFailedCheck + row.skippedFailedCheck,
    replacedExisting: acc.replacedExisting + row.replacedExisting,
    updatedExisting: acc.updatedExisting + row.updatedExisting,
  }), { discovered: 0, kept: 0, added: 0, skippedDuplicate: 0, skippedFailedCheck: 0, replacedExisting: 0, updatedExisting: 0 });
  const failedCatalogs = rows.filter((row) => row.errors.length > 0).length;
  const warningCatalogs = rows.filter((row) => row.warnings.length > 0).length;
  const github403Catalogs = rows.filter((row) => row.errors.some((error) => /GitHub tree HTTP 403/i.test(error))).length;

  const body = rows.map((row) => [
    row.catalogName,
    row.catalogKey,
    row.discovered,
    row.kept,
    row.added,
    row.skippedDuplicate,
    row.skippedFailedCheck,
    row.replacedExisting,
    row.updatedExisting,
    row.warnings.length ? row.warnings.join('<br>') : '-',
    row.errors.length ? row.errors.join('<br>') : '-',
    row.messages.length ? row.messages.join('<br>') : '-',
  ].join(' | '));

  return [
    '# 聚合源同步报告',
    '',
    `生成时间：${new Date().toISOString()}`,
    `输出文件：${out}`,
    `写入模式：${dryRun ? '预览，不写入' : '已写入'}`,
    '',
    '## 配置状态',
    '',
    `- 配置 catalog 总数：${meta.totalCatalogs}`,
    `- 启用 catalog 数：${meta.enabledCatalogs}`,
    `- 禁用 catalog 数：${meta.disabledCatalogs}`,
    `- 本次参与 catalog 数：${meta.selectedCatalogs}`,
    `- 选择模式：${meta.selectionMode}`,
    `- 禁用未参与：${meta.disabledCatalogKeys.length ? meta.disabledCatalogKeys.join(', ') : '-'}`,
    `- GitHub Token：${meta.githubTokenEnabled ? '已启用' : '未启用'}`,
    `- GitHub 缓存：${meta.githubCacheEnabled ? meta.githubCachePath : '已关闭'}`,
    `- GitHub 请求间隔：${meta.githubRequestDelayMs}ms`,
    `- GitHub 重试次数：${meta.githubRetry}`,
    `- GitHub 重试基础间隔：${meta.githubRetryDelayMs}ms`,
    `- Token 缓存：${meta.tokenCacheEnabled ? meta.tokenCachePath : '已关闭'}`,
    '',
    '## 同步结果',
    '',
    `- 发现入口：${totals.discovered}`,
    `- 保留候选：${totals.kept}`,
    `- 新增源：${totals.added}`,
    `- 重复跳过：${totals.skippedDuplicate}`,
    `- 校验失败跳过：${totals.skippedFailedCheck}`,
    `- 替换旧 catalog 条目：${totals.replacedExisting}`,
    `- 更新已有源：${totals.updatedExisting}`,
    `- 有错误 catalog 数：${failedCatalogs}`,
    `- 有警告 catalog 数：${warningCatalogs}`,
    `- GitHub 403 catalog 数：${github403Catalogs}`,
    '',
    '## 明细',
    '',
    '| 目录 | key | 发现入口 | 保留候选 | 新增 | 重复跳过 | 校验失败跳过 | 替换旧条目 | 更新 | 警告 | 错误 | 信息 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |',
    ...body.map((line) => `| ${line} |`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const configPath = resolve(args.config);
  if (args.init) {
    ensureDefaultCatalogFile(configPath);
    console.log(`[iptv-picker-source-sync] Default catalog config ready: ${args.config}`);
    return;
  }
  if (configPath === resolve(DEFAULT_CONFIG_PATH)) ensureDefaultCatalogFile(configPath);

  const config = JSON.parse(readFileSync(configPath, 'utf8')) as CatalogFile;
  const allCatalogs = config.catalogs || [];
  const only = args.only ? new Set(args.only) : undefined;
  const catalogs = allCatalogs
    .filter((catalog) => only ? only.has(catalog.key) : catalog.enabled !== false);
  if (catalogs.length === 0) throw new Error('No enabled catalog matched. Use --init or check --k/--key.');
  const disabledCatalogKeys = allCatalogs
    .filter((catalog) => catalog.enabled === false)
    .map((catalog) => catalog.key);
  const reportMeta: CatalogReportMeta = {
    totalCatalogs: allCatalogs.length,
    enabledCatalogs: allCatalogs.filter((catalog) => catalog.enabled !== false).length,
    disabledCatalogs: disabledCatalogKeys.length,
    selectedCatalogs: catalogs.length,
    selectionMode: args.only ? `--k ${args.only.join(',')}` : '默认启用 catalog',
    disabledCatalogKeys,
    githubCachePath: resolve(args.githubCache),
    githubCacheEnabled: args.githubCacheEnabled,
    githubTokenEnabled: Boolean(githubToken()),
    githubRequestDelayMs: args.githubRequestDelayMs,
    githubRetry: args.githubRetry,
    githubRetryDelayMs: args.githubRetryDelayMs,
    tokenCachePath: resolve(args.tokenCache),
    tokenCacheEnabled: args.tokenCacheEnabled,
  };
  const runtimeContext: RuntimeContext = {
    githubCachePath: resolve(args.githubCache),
    githubCacheEnabled: args.githubCacheEnabled,
    githubCache: readGithubCache(resolve(args.githubCache), args.githubCacheEnabled),
    githubCacheDirty: false,
    githubRequestDelayMs: args.githubRequestDelayMs,
    githubRetry: args.githubRetry,
    githubRetryDelayMs: args.githubRetryDelayMs,
    tokenCachePath: resolve(args.tokenCache),
    tokenCacheEnabled: args.tokenCacheEnabled,
    tokenCache: readTokenCache(resolve(args.tokenCache), args.tokenCacheEnabled),
    tokenCacheDirty: false,
  };

  const discovered: DiscoveredSource[] = [];
  const rows: CatalogSyncRow[] = [];
  for (const catalog of catalogs) {
    if (!args.quiet) console.log(`[iptv-picker-source-sync] Syncing ${catalog.name} (${catalog.key})...`);
    const result = await discoverCatalog(catalog, args.check, runtimeContext);
    discovered.push(...result.sources);
    rows.push(result.row);
  }

  const out = resolve(args.out);
  const existing = readJsonFile(out);
  const merged = mergeSources(existing, discovered, args.replaceCatalog);
  for (const row of rows) {
    row.added = merged.addedByCatalog[row.catalogKey] || 0;
    row.skippedDuplicate = merged.skippedDuplicateByCatalog[row.catalogKey] || 0;
    row.replacedExisting = merged.replacedExistingByCatalog[row.catalogKey] || 0;
    row.updatedExisting = merged.updatedExistingByCatalog[row.catalogKey] || 0;
  }

  if (!args.dryRun) {
    writeJson(out, merged.output);
    if (runtimeContext.githubCacheEnabled && runtimeContext.githubCacheDirty) {
      writeGithubCache(runtimeContext.githubCachePath, runtimeContext.githubCache);
    }
    if (runtimeContext.tokenCacheEnabled && runtimeContext.tokenCacheDirty) {
      writeTokenCache(runtimeContext.tokenCachePath, runtimeContext.tokenCache);
    }
    const report = markdownReport(rows, out, false, reportMeta);
    mkdirSync(dirname(resolve(args.report)), { recursive: true });
    writeFileSync(resolve(args.report), report, 'utf8');
  }

  const summary = {
    config: configPath,
    out,
    report: resolve(args.report),
    dryRun: args.dryRun,
    catalogs: rows,
    discoveredSources: discovered.length,
    addedToOutput: merged.added,
    skippedOutputDuplicates: merged.skippedDuplicate,
    replacedExisting: merged.replacedExisting,
    updatedExisting: merged.updatedExisting,
  };

  if (args.dryRun) {
    const report = markdownReport(rows, out, true, reportMeta);
    if (!args.quiet) console.log(report);
  }
  if (args.print) console.log(JSON.stringify(summary, null, 2));
  if (!args.quiet) {
    console.log(`[iptv-picker-source-sync] discovered ${discovered.length}, added ${merged.added}, skipped duplicates ${merged.skippedDuplicate}`);
    if (!args.dryRun) console.log(`[iptv-picker-source-sync] wrote ${out}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[iptv-picker-source-sync] ${message}`);
  process.exit(1);
});
