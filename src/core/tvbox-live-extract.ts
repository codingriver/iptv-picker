export interface TvboxConfigInputSource {
  name: string;
  url: string;
  content?: string;
  enabled?: boolean;
}

export interface ExtractedLiveSource {
  name: string;
  url: string;
  content?: string;
  sourceKind: 'config';
  sourceConfigName: string;
  sourceConfigUrl: string;
  liveName?: string;
  liveType?: number;
  ua?: string;
  enabled?: boolean;
  notes?: string;
}

export interface TvboxLiveExtractWarning {
  configName: string;
  configUrl: string;
  path: string;
  message: string;
  severity?: 'warning' | 'error';
  code?: string;
}

export interface TvboxLiveExtractResult {
  generatedAt: string;
  purpose: string;
  sources: ExtractedLiveSource[];
  summary: {
    configs: number;
    skippedConfigs: number;
    downloadedConfigs: number;
    failedConfigs: number;
    liveEntries: number;
    extractedSources: number;
    inlineSources: number;
    relativeResolved: number;
    singleChannelWrapped: number;
    skippedLives: number;
    duplicatesRemoved: number;
  };
  warnings: TvboxLiveExtractWarning[];
}

interface TvboxLiveItem {
  name?: unknown;
  url?: unknown;
  type?: unknown;
  ua?: unknown;
}

interface TvboxConfigJson {
  lives?: unknown;
}

const PLAYABLE_URL_RE = /^(https?|rtp|rtsp|udp):\/\//i;
const M3U8_URL_RE = /\.m3u8(?:$|[?#])/i;

export function isLikelyLivePlaylistUrl(value: string): boolean {
  return /\.(m3u8?|txt)(?:$|[?#])/i.test(value) ||
    /\/(live|iptv|tvlive|tvbox|itv|list|playlist)(?:\.[a-z0-9]+)?(?:$|[?#])/i.test(value);
}

function isInlineLiveContent(value: string): boolean {
  return value.includes('#EXTM3U') ||
    value.includes('#EXTINF') ||
    value.includes('#genre#') ||
    /^.{1,80},\s*(https?|rtsp?|rtp|udp):\/\//im.test(value);
}

function stripBom(value: string): string {
  return value.replace(/^\uFEFF/, '');
}

function parseJsonLoose(content: string): unknown {
  const text = stripBom(content.trim());
  const jsonStart = text.search(/[{\[]/);
  const body = jsonStart > 0 ? text.slice(jsonStart) : text;
  try {
    return JSON.parse(body);
  } catch {
    return JSON.parse(stripJsonCommentsAndTrailingCommas(body));
  }
}

function stripJsonCommentsAndTrailingCommas(value: string): string {
  let output = '';
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const next = value[i + 1];

    if (inString) {
      output += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      output += ch;
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < value.length && value[i] !== '\n') i++;
      output += '\n';
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < value.length && !(value[i] === '*' && value[i + 1] === '/')) i++;
      i++;
      continue;
    }

    if (ch === '#') {
      while (i < value.length && value[i] !== '\n') i++;
      output += '\n';
      continue;
    }

    output += ch;
  }

  return output.replace(/,\s*([}\]])/g, '$1');
}

function normalizeName(value: unknown, fallback: string): string {
  const text = String(value || '').replace(/[\r\n]+/g, ' ').trim();
  return text || fallback;
}

function stableInlineUrl(configName: string, configUrl: string, index: number): string {
  const slug = `${configName}-${configUrl}-${index}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `live-${index}`;
  return `tvbox-inline://${slug}`;
}

function absoluteMaybe(value: string, baseUrl: string): { url: string; relativeResolved: boolean } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (PLAYABLE_URL_RE.test(trimmed)) return { url: trimmed, relativeResolved: false };
  if (/^(data|file|jar|clan):/i.test(trimmed)) return null;
  try {
    const resolved = new URL(trimmed, baseUrl);
    if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
      return { url: resolved.toString(), relativeResolved: true };
    }
  } catch {
    return null;
  }
  return null;
}

async function downloadConfig(source: TvboxConfigInputSource): Promise<string> {
  if (source.content && source.content.trim()) return source.content;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'okhttp/3.12.0' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeLiveItems(rawLives: unknown): TvboxLiveItem[] {
  if (!Array.isArray(rawLives)) return [];
  const items: TvboxLiveItem[] = [];
  for (const item of rawLives) {
    if (item && typeof item === 'object') {
      items.push(item as TvboxLiveItem);
    }
  }
  return items;
}

function splitCandidateUrls(value: string): string[] {
  const text = value.trim();
  if (!text) return [];
  if (isInlineLiveContent(text)) return [text];
  if (PLAYABLE_URL_RE.test(text) || text.startsWith('./') || text.startsWith('../') || text.startsWith('/')) return [text];

  return text
    .split(/\r?\n|[|;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function extractTvboxLiveSources(
  configs: TvboxConfigInputSource[],
  options?: { dedupe?: boolean },
): Promise<TvboxLiveExtractResult> {
  const dedupe = options?.dedupe !== false;
  const warnings: TvboxLiveExtractWarning[] = [];
  const sources: ExtractedLiveSource[] = [];
  let skippedConfigs = 0;
  let downloadedConfigs = 0;
  let failedConfigs = 0;
  let liveEntries = 0;
  let inlineSources = 0;
  let relativeResolved = 0;
  let singleChannelWrapped = 0;
  let skippedLives = 0;

  for (const config of configs) {
    if (config.enabled === false) {
      skippedConfigs++;
      continue;
    }

    let parsed: TvboxConfigJson;
    try {
      const content = await downloadConfig(config);
      downloadedConfigs++;
      parsed = parseJsonLoose(content) as TvboxConfigJson;
    } catch (error) {
      failedConfigs++;
      warnings.push({
        configName: config.name,
        configUrl: config.url,
        path: '$',
        message: `Failed to download or parse config: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'error',
        code: 'CONFIG_DOWNLOAD_OR_PARSE_FAILED',
      });
      continue;
    }

    const lives = normalizeLiveItems(parsed.lives);
    liveEntries += lives.length;
    if (lives.length === 0) {
      warnings.push({
        configName: config.name,
        configUrl: config.url,
        path: '$.lives',
        message: 'No lives[] entries found.',
        severity: 'warning',
        code: 'NO_LIVES',
      });
      continue;
    }

    lives.forEach((live, index) => {
      const liveName = normalizeName(live.name, `live-${index + 1}`);
      const rawUrl = typeof live.url === 'string' ? live.url.trim() : '';
      const liveType = typeof live.type === 'number' ? live.type : undefined;
      const ua = typeof live.ua === 'string' && live.ua.trim() ? live.ua.trim() : undefined;
      const path = `$.lives[${index}].url`;

      if (!rawUrl) {
        skippedLives++;
        warnings.push({
          configName: config.name,
          configUrl: config.url,
          path,
          message: 'Missing live URL.',
          severity: 'warning',
          code: 'MISSING_LIVE_URL',
        });
        return;
      }

      const candidates = splitCandidateUrls(rawUrl);
      if (candidates.length === 0) {
        skippedLives++;
        warnings.push({
          configName: config.name,
          configUrl: config.url,
          path,
          message: 'No supported URL/content candidate found.',
          severity: 'warning',
          code: 'NO_SUPPORTED_LIVE_CANDIDATE',
        });
        return;
      }

      for (const candidate of candidates) {
        const base: Omit<ExtractedLiveSource, 'url'> = {
          name: `${config.name} / ${liveName}`,
          sourceKind: 'config',
          sourceConfigName: config.name,
          sourceConfigUrl: config.url,
          liveName,
          liveType,
          ua,
        };

        if (isInlineLiveContent(candidate)) {
          inlineSources++;
          sources.push({
            ...base,
            url: stableInlineUrl(config.name, config.url, index),
            content: candidate,
            notes: 'Inline TVBox lives[].url content extracted as source content.',
          });
          continue;
        }

        const resolved = absoluteMaybe(candidate, config.url);
        if (!resolved) {
          skippedLives++;
          warnings.push({
            configName: config.name,
            configUrl: config.url,
            path,
            message: `Unsupported live URL: ${candidate}`,
            severity: 'warning',
            code: 'UNSUPPORTED_LIVE_URL',
          });
          continue;
        }

        if (resolved.relativeResolved) relativeResolved++;
        if (M3U8_URL_RE.test(resolved.url)) {
          singleChannelWrapped++;
          sources.push({
            ...base,
            url: resolved.url,
            content: `${liveName},${resolved.url}`,
            notes: 'Single-channel M3U8 wrapped as DIYP one-line content.',
          });
        } else {
          sources.push({
            ...base,
            url: resolved.url,
          });
        }
      }
    });
  }

  let duplicatesRemoved = 0;
  const finalSources = dedupe
    ? sources.filter((source, index, list) => {
      const key = source.content ? `${source.url}\n${source.content}` : source.url;
      const first = list.findIndex((item) => (item.content ? `${item.url}\n${item.content}` : item.url) === key);
      const keep = first === index;
      if (!keep) duplicatesRemoved++;
      return keep;
    })
    : sources;

  return {
    generatedAt: new Date().toISOString(),
    purpose: 'Live source entries extracted from TVBox JSON configs.',
    sources: finalSources,
    summary: {
      configs: configs.length,
      skippedConfigs,
      downloadedConfigs,
      failedConfigs,
      liveEntries,
      extractedSources: finalSources.length,
      inlineSources,
      relativeResolved,
      singleChannelWrapped,
      skippedLives,
      duplicatesRemoved,
    },
    warnings,
  };
}
