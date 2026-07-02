import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export const TVBOX_UA = 'okhttp/3.12.0';

export const DEFAULT_COMMON_CONFIG_PATH = resolve('config', 'common.json');

export const DEFAULT_GITHUB_ACCELERATOR_PREFIXES = [
  'https://gh.aptv.app/',
  'https://gh-proxy.org/',
  'https://gh.llkk.cc/',
  'https://mirror.ghproxy.com/',
  'https://github.moeyy.xyz/',
  'https://ghp.ci/',
  'https://gh.927223.xyz/',
  'https://gh.halonice.com/',
  'https://ghfile.geekertao.top/',
];

export type GithubAcceleratorMode = 'enabled' | 'disabled' | 'forced';

export interface CommonConfigFile {
  schemaVersion?: number;
  generatedAt?: string;
  purpose?: string;
  githubAcceleratorMode?: unknown;
  githubAccelerators?: unknown;
  github?: {
    acceleratorMode?: unknown;
    accelerators?: unknown;
  };
}

let commonConfigCache: { path: string; config: CommonConfigFile } | undefined;

function normalizePrefix(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normalizeMode(value: unknown): GithubAcceleratorMode | undefined {
  if (typeof value === 'boolean') return value ? 'enabled' : 'disabled';
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['enabled', 'enable', 'on', 'true', '启用'].includes(normalized)) return 'enabled';
  if (['disabled', 'disable', 'off', 'false', '禁用'].includes(normalized)) return 'disabled';
  if (['forced', 'force', 'always', 'accelerated', '强制启用'].includes(normalized)) return 'forced';
  return undefined;
}

function readCommonConfig(filePath = DEFAULT_COMMON_CONFIG_PATH): CommonConfigFile {
  const resolved = resolve(filePath);
  if (commonConfigCache?.path === resolved) return commonConfigCache.config;
  if (!existsSync(resolved)) {
    const config: CommonConfigFile = { githubAccelerators: DEFAULT_GITHUB_ACCELERATOR_PREFIXES };
    commonConfigCache = { path: resolved, config };
    return config;
  }
  try {
    const parsed = JSON.parse(readFileSync(resolved, 'utf8')) as CommonConfigFile;
    commonConfigCache = { path: resolved, config: parsed };
    return parsed;
  } catch {
    const config: CommonConfigFile = { githubAccelerators: DEFAULT_GITHUB_ACCELERATOR_PREFIXES };
    commonConfigCache = { path: resolved, config };
    return config;
  }
}

export function githubAcceleratorPrefixes(filePath = DEFAULT_COMMON_CONFIG_PATH): string[] {
  const config = readCommonConfig(filePath);
  const configured = Array.isArray(config.githubAccelerators)
    ? config.githubAccelerators
    : Array.isArray(config.github?.accelerators)
      ? config.github.accelerators
      : DEFAULT_GITHUB_ACCELERATOR_PREFIXES;
  const prefixes = configured
    .map(normalizePrefix)
    .filter((value): value is string => Boolean(value));
  return uniqueStrings(prefixes.length ? prefixes : DEFAULT_GITHUB_ACCELERATOR_PREFIXES);
}

export function githubAcceleratorMode(filePath = DEFAULT_COMMON_CONFIG_PATH): GithubAcceleratorMode {
  const config = readCommonConfig(filePath);
  return normalizeMode(config.githubAcceleratorMode)
    || normalizeMode(config.github?.acceleratorMode)
    || 'enabled';
}

function isGithubUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.hostname === 'github.com'
      || parsed.hostname === 'raw.githubusercontent.com'
      || parsed.hostname === 'api.github.com';
  } catch {
    return false;
  }
}

export function unwrapGithubAcceleratedUrl(value: string, filePath = DEFAULT_COMMON_CONFIG_PATH): string {
  const trimmed = value.trim();
  for (const prefix of githubAcceleratorPrefixes(filePath)) {
    if (!trimmed.startsWith(prefix)) continue;
    const unwrapped = trimmed.slice(prefix.length);
    if (isGithubUrl(unwrapped)) return unwrapped;
  }
  return trimmed;
}

export function githubAcceleratedUrls(value: string, filePath = DEFAULT_COMMON_CONFIG_PATH): string[] {
  if (githubAcceleratorMode(filePath) === 'disabled') return [];
  const unwrapped = unwrapGithubAcceleratedUrl(value, filePath);
  if (!isGithubUrl(unwrapped)) return [];
  return uniqueStrings(githubAcceleratorPrefixes(filePath)
    .map((prefix) => `${prefix}${unwrapped}`)
    .filter((url) => url !== value));
}

export function githubRequestUrls(value: string, filePath = DEFAULT_COMMON_CONFIG_PATH): string[] {
  const mode = githubAcceleratorMode(filePath);
  if (mode === 'disabled') return [value];

  const accelerated = githubAcceleratedUrls(value, filePath);
  if (!accelerated.length) return [value];
  if (mode === 'forced') return accelerated;
  return uniqueStrings([value, ...accelerated]);
}
