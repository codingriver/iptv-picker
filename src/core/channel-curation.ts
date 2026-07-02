import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { IptvPickerCoreChannelEntry, ChannelCurationPreset, ChannelCurationSummary, ChannelCurationChannelSummary } from './types';

export interface ChannelTargetGroupConfig {
  name: string;
  channels: string[];
}

export interface ChannelTargetPresetConfig {
  key: ChannelCurationPreset;
  label: string;
  description: string;
  extends?: ChannelCurationPreset[];
  keepPerChannel?: number;
  groups?: ChannelTargetGroupConfig[];
}

export interface ChannelTargetsFile {
  generatedAt?: string;
  purpose?: string;
  defaultPreset?: ChannelCurationPreset;
  presets?: ChannelTargetPresetConfig[];
}

export interface ChannelAliasItem {
  canonical: string;
  aliases: string[];
}

export interface ChannelAliasesFile {
  generatedAt?: string;
  purpose?: string;
  aliases?: ChannelAliasItem[];
}

export interface CuratedChannelEntry extends IptvPickerCoreChannelEntry {
  curatedChannel?: string;
  curatedGroup?: string;
  curationKey?: string;
}

export interface ChannelCurationOptions {
  targetsFilePath?: string;
  aliasesFilePath?: string;
  keepPerChannel?: number;
  preferredMinHeight?: number;
  fallbackMinHeight?: number;
  allowLowResFallback?: boolean;
  includeUnmatched?: boolean;
  includeFailed?: boolean;
}

export interface ChannelNameMatch {
  group: string;
  channel: string;
  key: string;
  matchedAlias?: string;
  matchedCanonical?: string;
}

interface AliasLookupItem {
  canonical: string;
  aliases: string[];
}

interface AliasMatchToken {
  token: string;
  canonical: string;
  canonicalKey: string;
  alias: string;
  order: number;
}

interface NormalizedChannelCandidate {
  normalized: string;
  priority: number;
}

const DEFAULT_CHANNEL_TARGETS_PATH = resolve('config', 'channel-targets.json');
const DEFAULT_CHANNEL_ALIASES_PATH = resolve('config', 'channel-aliases.json');

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\-_./|·,:，。、()（）[\]{}<>]+/g, '')
    .replace(/[+＋]/g, '+')
    .replace(/[^0-9a-z\u4e00-\u9fa5+]/g, '');
}

function normalizeEvidenceText(value: string): string {
  try {
    return normalizeText(decodeURIComponent(value));
  } catch {
    return normalizeText(value);
  }
}

function decodeText(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function pushNormalizedCandidate(
  candidates: NormalizedChannelCandidate[],
  seen: Map<string, number>,
  value: string,
  priority: number,
): void {
  const normalized = normalizeText(value);
  if (!normalized) return;
  const existingPriority = seen.get(normalized);
  if (existingPriority != null && existingPriority >= priority) return;
  seen.set(normalized, priority);
  const existing = candidates.find((item) => item.normalized === normalized);
  if (existing) {
    existing.priority = priority;
    return;
  }
  candidates.push({ normalized, priority });
}

function extractLinearChannelCandidates(value: string): string[] {
  const labels: string[] = [];
  const text = decodeText(value);

  for (const match of text.matchAll(/(?:^|[^0-9a-z])cctv\s*[-_ ]?\s*(\d{1,2})(?:\s*[-_ ]?\s*(\+|plus|k))?/gi)) {
    const channelNumber = Number(match[1]);
    if (channelNumber < 1 || channelNumber > 17) continue;
    const suffix = (match[2] || '').toLowerCase();
    if (suffix === 'plus') labels.push(`cctv${channelNumber}+`);
    else if (suffix === '+' || suffix === 'k') labels.push(`cctv${channelNumber}${suffix}`);
    else labels.push(`cctv${channelNumber}`);
  }

  for (const match of text.matchAll(/(?:^|[^0-9a-z])cetv\s*[-_ ]?\s*([124])/gi)) {
    labels.push(`cetv${Number(match[1])}`);
  }

  return labels;
}

function stripTrailingChannelDecorations(value: string): string[] {
  const variants: string[] = [];
  let current = decodeText(value).trim();
  const qualityToken = '(?:\\d{3,4}\\s*[pi]?|\\d+\\s*m(?:bps)?\\s*\\d{3,4}\\s*[pi]?|[48]k|hd|fhd|uhd|sd|hevc|h\\.?26[45]|超高清|超清|高清|标清|蓝光|原画|流畅)';
  const bracketPattern = new RegExp(`\\s*[\\(（\\[【]\\s*(?:${qualityToken}|not\\s*24\\s*/\\s*7|geo\\s*-?blocked)\\s*[\\)）\\]】]\\s*$`, 'i');
  const suffixPattern = new RegExp(`(?:[\\s_./|·,:，。、-]+${qualityToken})+\\s*$`, 'i');

  for (let i = 0; i < 5; i += 1) {
    const next = current
      .replace(bracketPattern, '')
      .replace(suffixPattern, '')
      .trim();
    if (!next || next === current) break;
    variants.push(next);
    current = next;
  }

  return variants;
}

function buildNormalizedChannelCandidates(channelName: string): NormalizedChannelCandidate[] {
  const candidates: NormalizedChannelCandidate[] = [];
  const seen = new Map<string, number>();

  for (const label of extractLinearChannelCandidates(channelName)) {
    pushNormalizedCandidate(candidates, seen, label, 300);
  }
  for (const variant of stripTrailingChannelDecorations(channelName)) {
    pushNormalizedCandidate(candidates, seen, variant, 200);
  }
  pushNormalizedCandidate(candidates, seen, channelName, 100);

  return candidates.sort((a, b) => b.priority - a.priority || b.normalized.length - a.normalized.length);
}

function canonicalFamilyKey(channel: string): string {
  const normalized = normalizeText(channel);
  const cctv = normalized.match(/^cctv(\d{1,2})(\+|plus|k)?$/);
  if (cctv) {
    const suffix = cctv[2] === 'plus' ? '+' : cctv[2] || '';
    return `cctv-${Number(cctv[1])}${suffix}`;
  }
  const cetv = normalized.match(/^cetv(\d)$/);
  if (cetv) return `cetv-${Number(cetv[1])}`;
  return normalized;
}

function extractLinearChannelKeysFromEvidence(evidence: string): Set<string> {
  const keys = new Set<string>();
  const normalized = normalizeEvidenceText(evidence);

  for (const match of normalized.matchAll(/cctv(\d{1,2})(\+|plus|k)?/g)) {
    const suffix = match[2] === 'plus' ? '+' : match[2] || '';
    keys.add(`cctv-${Number(match[1])}${suffix}`);
  }
  for (const match of normalized.matchAll(/cetv(\d)/g)) {
    keys.add(`cetv-${Number(match[1])}`);
  }

  return keys;
}

function scoreResolution(value: string | null | undefined): number {
  if (!value) return 0;
  const match = value.match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return 0;
  return Number(match[2]) || 0;
}

function scoreEntry(entry: IptvPickerCoreChannelEntry): number {
  if (!entry.ok) return -1_000_000;
  const height = scoreResolution(entry.resolution);
  const bitrate = Number(entry.bitrate || 0);
  const fps = Number(entry.fps || 0);
  const source = `${entry.sourceName || ''} ${entry.sourceUrl || ''}`.toLowerCase();
  let sourceBonus = 0;
  if (/肥羊|zbds|guovin|fanmingming|qist|gxnas|vbskycn|jinenge|collect-txt|aptv|iptv-org/.test(source)) sourceBonus += 3000;
  if (/ipv6/.test(source)) sourceBonus += 200;
  if (/ipv4/.test(source)) sourceBonus += 100;
  return 1_000_000 + height * 1000 + Math.round(bitrate / 1000) + Math.round(fps * 10) + sourceBonus;
}

function qualityRank(
  entry: IptvPickerCoreChannelEntry,
  options: { preferredMinHeight?: number; fallbackMinHeight?: number; allowLowResFallback?: boolean; includeFailed?: boolean },
): number {
  if (!entry.ok) return options.includeFailed ? 1 : 0;
  const height = scoreResolution(entry.resolution);
  if (options.preferredMinHeight && height >= options.preferredMinHeight) return 3;
  if (options.fallbackMinHeight && height >= options.fallbackMinHeight) return 2;
  return options.allowLowResFallback === false ? 0 : 1;
}

function qualityLabel(rank: number): { value: IptvPickerCoreChannelEntry['curationQuality']; label: string } {
  if (rank >= 3) return { value: 'preferred', label: '高清优选' };
  if (rank >= 2) return { value: 'fallback', label: '清晰兜底' };
  if (rank >= 1) return { value: 'low-res-fallback', label: '低清兜底' };
  return { value: 'unknown', label: '未知' };
}

function loadJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function flattenTargetChannels(preset: ChannelTargetPresetConfig): Array<{ group: string; channel: string }> {
  const items: Array<{ group: string; channel: string }> = [];
  for (const group of preset.groups || []) {
    for (const channel of group.channels || []) {
      if (!String(channel || '').trim()) continue;
      items.push({ group: group.name, channel: channel.trim() });
    }
  }
  return items;
}

function mergeTargetGroups(
  baseGroups: ChannelTargetGroupConfig[],
  nextGroups: ChannelTargetGroupConfig[],
): ChannelTargetGroupConfig[] {
  const merged: ChannelTargetGroupConfig[] = baseGroups.map((group) => ({
    name: group.name,
    channels: [...group.channels],
  }));
  const groupByName = new Map(merged.map((group) => [group.name, group]));

  for (const nextGroup of nextGroups || []) {
    const groupName = String(nextGroup.name || '').trim();
    if (!groupName) continue;
    let targetGroup = groupByName.get(groupName);
    if (!targetGroup) {
      targetGroup = { name: groupName, channels: [] };
      groupByName.set(groupName, targetGroup);
      merged.push(targetGroup);
    }
    const seenChannels = new Set(targetGroup.channels.map((channel) => normalizeText(channel)));
    for (const channel of nextGroup.channels || []) {
      const channelName = String(channel || '').trim();
      if (!channelName) continue;
      const key = normalizeText(channelName);
      if (seenChannels.has(key)) continue;
      seenChannels.add(key);
      targetGroup.channels.push(channelName);
    }
  }

  return merged;
}

function resolvePreset(
  presetKey: ChannelCurationPreset,
  presetMap: Map<ChannelCurationPreset, ChannelTargetPresetConfig>,
  stack: ChannelCurationPreset[] = [],
): ChannelTargetPresetConfig | undefined {
  const preset = presetMap.get(presetKey);
  if (!preset) return undefined;
  if (stack.includes(presetKey)) {
    throw new Error(`Channel target preset extends cycle: ${[...stack, presetKey].join(' -> ')}`);
  }

  let groups: ChannelTargetGroupConfig[] = [];
  for (const parentKey of preset.extends || []) {
    const parent = resolvePreset(parentKey, presetMap, [...stack, presetKey]);
    if (!parent) {
      throw new Error(`Channel target preset "${preset.key}" extends missing preset "${parentKey}"`);
    }
    groups = mergeTargetGroups(groups, parent.groups || []);
  }
  groups = mergeTargetGroups(groups, preset.groups || []);

  return {
    ...preset,
    extends: preset.extends ? [...preset.extends] : undefined,
    groups,
  };
}

function buildAliasLookup(aliases: ChannelAliasItem[]): Map<string, AliasLookupItem> {
  const map = new Map<string, AliasLookupItem>();
  for (const item of aliases) {
    const canonical = item.canonical.trim();
    if (!canonical) continue;
    map.set(normalizeText(canonical), {
      canonical,
      aliases: [canonical, ...(item.aliases || [])].map((alias) => alias.trim()).filter(Boolean),
    });
  }
  return map;
}

function buildEvidenceAliasTokens(
  aliases: Map<string, AliasLookupItem>,
  presetChannels: Set<string>,
): Array<{ token: string; canonical: string; key: string }> {
  const tokens: Array<{ token: string; canonical: string; key: string }> = [];
  for (const item of aliases.values()) {
    const key = normalizeText(item.canonical);
    if (!presetChannels.has(key)) continue;
    for (const alias of item.aliases) {
      const token = normalizeEvidenceText(alias);
      if (!token || token.length < 3) continue;
      tokens.push({ token, canonical: item.canonical, key });
    }
  }
  return tokens
    .sort((a, b) => b.token.length - a.token.length || a.token.localeCompare(b.token, 'zh-CN'));
}

function buildAliasMatchTokens(aliases: Map<string, AliasLookupItem>): AliasMatchToken[] {
  const byToken = new Map<string, AliasMatchToken>();
  let order = 0;
  for (const item of aliases.values()) {
    const canonicalKey = normalizeText(item.canonical);
    for (const alias of item.aliases) {
      const token = normalizeText(alias);
      if (!token || token.length < 2) continue;
      const existing = byToken.get(token);
      if (existing && existing.alias.length >= alias.length) continue;
      byToken.set(token, { token, canonical: item.canonical, canonicalKey, alias, order: order++ });
    }
  }
  return Array.from(byToken.values())
    .sort(compareAliasMatchTokens);
}

function compareAliasMatchTokens(a: AliasMatchToken, b: AliasMatchToken): number {
  return b.token.length - a.token.length
    || b.canonicalKey.length - a.canonicalKey.length
    || b.alias.length - a.alias.length
    || a.token.localeCompare(b.token, 'zh-CN')
    || a.order - b.order;
}

function isCctvOrCetvToken(token: string): boolean {
  return /^(cctv\d{1,2}(?:\+|plus|k)?|cetv\d)$/i.test(token);
}

function isSafeEmbeddedMatch(normalized: string, token: string, index: number): boolean {
  if (normalized === token) return true;
  const next = normalized[index + token.length] || '';
  if (!isCctvOrCetvToken(token)) return true;

  // Prevent broad tokens from stealing more specific channels:
  // CCTV1 must not match CCTV10, CCTV5 must not match CCTV5+, CCTV4 must not match CCTV4K.
  if (/\d/.test(next) || next === '+' || next === 'k') return false;
  if (next === 'p' && normalized.slice(index + token.length).startsWith('plus')) return false;
  return true;
}

function tokenMatchesNormalizedChannel(normalized: string, token: string): boolean {
  if (!normalized || !token) return false;
  if (normalized === token) return true;
  let index = normalized.indexOf(token);
  while (index >= 0) {
    if (isSafeEmbeddedMatch(normalized, token, index)) return true;
    index = normalized.indexOf(token, index + 1);
  }
  return false;
}

function findBestAliasMatch(
  candidates: NormalizedChannelCandidate[],
  tokens: AliasMatchToken[],
): { canonical: string; alias: string } | null {
  const matches: Array<AliasMatchToken & { exact: boolean; candidatePriority: number }> = [];
  for (const candidate of candidates) {
    for (const item of tokens) {
      if (candidate.normalized === item.token) {
        matches.push({ ...item, exact: true, candidatePriority: candidate.priority });
        continue;
      }
      if (tokenMatchesNormalizedChannel(candidate.normalized, item.token)) {
        matches.push({ ...item, exact: false, candidatePriority: candidate.priority });
      }
    }
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => b.candidatePriority - a.candidatePriority
    || Number(b.exact) - Number(a.exact)
    || compareAliasMatchTokens(a, b));
  return { canonical: matches[0].canonical, alias: matches[0].alias };
}

function findBestAliasMatchFromNormalized(
  normalized: string,
  tokens: AliasMatchToken[],
): { canonical: string; alias: string } | null {
  const matches: Array<AliasMatchToken & { exact: boolean }> = [];
  for (const item of tokens) {
    if (normalized === item.token) {
      matches.push({ ...item, exact: true });
      continue;
    }
    if (tokenMatchesNormalizedChannel(normalized, item.token)) {
      matches.push({ ...item, exact: false });
    }
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => Number(b.exact) - Number(a.exact) || compareAliasMatchTokens(a, b));
  return { canonical: matches[0].canonical, alias: matches[0].alias };
}

function evidenceTextForEntry(entry: IptvPickerCoreChannelEntry): string {
  return [
    entry.bareUrl,
    entry.sourceName,
    entry.sourceUrl,
  ].filter(Boolean).join(' ');
}

function hasChannelEvidenceConflict(
  entry: IptvPickerCoreChannelEntry,
  target: { channel: string; key: string },
  evidenceAliasTokens: Array<{ token: string; canonical: string; key: string }>,
): boolean {
  const evidence = evidenceTextForEntry(entry);
  if (!evidence.trim()) return false;

  const targetFamilyKey = canonicalFamilyKey(target.channel);
  for (const key of extractLinearChannelKeysFromEvidence(evidence)) {
    if (key !== targetFamilyKey) return true;
  }

  const normalizedEvidence = normalizeEvidenceText(evidence);
  const evidenceTokens = evidenceAliasTokens.map((token, index) => ({
    token: token.token,
    canonical: token.canonical,
    canonicalKey: token.key,
    alias: token.canonical,
    order: index,
  }));
  const evidenceMatch = findBestAliasMatchFromNormalized(normalizedEvidence, evidenceTokens);
  if (evidenceMatch && normalizeText(evidenceMatch.canonical) !== target.key) return true;
  for (const token of evidenceAliasTokens) {
    if (token.key === target.key) continue;
    if (tokenMatchesNormalizedChannel(normalizedEvidence, token.token)) return true;
  }

  return false;
}

function defaultTargets(): ChannelTargetsFile {
  return {
    generatedAt: new Date().toISOString(),
    purpose: 'Default mainland live channel target presets.',
    defaultPreset: 'cn',
    presets: [
      {
        key: 'cn',
        label: '央视卫视频道',
        description: '覆盖常见央视、教育台和省级卫视。',
        groups: [
          {
            name: '央视',
            channels: ['CCTV-1', 'CCTV-2', 'CCTV-3', 'CCTV-4', 'CCTV-5', 'CCTV-5+', 'CCTV-6', 'CCTV-7', 'CCTV-8', 'CCTV-9', 'CCTV-10', 'CCTV-11', 'CCTV-12', 'CCTV-13', 'CCTV-14', 'CCTV-15', 'CCTV-16', 'CCTV-17', 'CCTV-4K', 'CCTV-8K', 'CETV-1', 'CETV-2', 'CETV-4'],
          },
          {
            name: '卫视',
            channels: ['湖南卫视', '浙江卫视', '江苏卫视', '东方卫视', '北京卫视', '广东卫视', '深圳卫视', '安徽卫视', '山东卫视', '湖北卫视', '河南卫视', '河北卫视', '辽宁卫视', '吉林卫视', '黑龙江卫视', '天津卫视', '重庆卫视', '四川卫视', '贵州卫视', '云南卫视', '广西卫视', '江西卫视', '东南卫视', '厦门卫视', '海南卫视', '陕西卫视', '山西卫视', '甘肃卫视', '宁夏卫视', '青海卫视', '新疆卫视', '西藏卫视', '内蒙古卫视', '兵团卫视', '三沙卫视'],
          },
        ],
      },
      {
        key: 'cn-full',
        label: '央视卫视扩展频道',
        description: '覆盖央视、教育台、省级卫视和大陆地方特色卫视。',
        extends: ['cn'],
        groups: [
          {
            name: '地方特色',
            channels: ['大湾区卫视', '康巴卫视', '安多卫视', '农林卫视', '海峡卫视', '延边卫视', '旅游卫视', '山东教育卫视', '南方卫视'],
          },
        ],
      },
      {
        key: 'cn-plus',
        label: '央视卫视扩展港澳台',
        description: '覆盖央视、教育台、省级卫视、大陆地方特色卫视和常见港澳台中文频道。',
        extends: ['cn-full'],
        groups: [
          {
            name: '港澳台',
            channels: ['凤凰卫视', '凤凰资讯', '香港卫视', '澳门卫视', '澳亚卫视', '莲花卫视', 'TVB翡翠台', 'TVB明珠台', 'RTHK 31', 'RTHK 32', '中天新闻', '中视', '华视', '台视', '民视', '东森新闻', '三立新闻', 'TVBS新闻'],
          },
        ],
      },
    ],
  };
}

function defaultAliases(): ChannelAliasesFile {
  return {
    generatedAt: new Date().toISOString(),
    purpose: 'Common aliases for mainland CCTV and satellite channels.',
    aliases: [
      { canonical: 'CCTV-1', aliases: ['CCTV1', 'CCTV-1综合', 'CCTV1综合', '央视一套', '央视1套'] },
      { canonical: 'CCTV-2', aliases: ['CCTV2', 'CCTV-2财经', 'CCTV2财经', '央视二套', '央视2套'] },
      { canonical: 'CCTV-3', aliases: ['CCTV3', 'CCTV-3综艺', 'CCTV3综艺', '央视三套', '央视3套'] },
      { canonical: 'CCTV-4', aliases: ['CCTV4', 'CCTV-4中文国际', 'CCTV4中文国际', '央视四套', '央视4套'] },
      { canonical: 'CCTV-5', aliases: ['CCTV5', 'CCTV-5体育', 'CCTV5体育', '央视五套', '央视5套'] },
      { canonical: 'CCTV-5+', aliases: ['CCTV5+', 'CCTV-5+体育赛事', 'CCTV5+体育赛事', '体育赛事'] },
      { canonical: 'CCTV-6', aliases: ['CCTV6', 'CCTV-6电影', 'CCTV6电影', '央视六套', '央视6套'] },
      { canonical: 'CCTV-7', aliases: ['CCTV7', 'CCTV-7国防军事', 'CCTV7国防军事', 'CCTV-7军事农业', 'CCTV7军事农业', '央视七套', '央视7套'] },
      { canonical: 'CCTV-8', aliases: ['CCTV8', 'CCTV-8电视剧', 'CCTV8电视剧', '央视八套', '央视8套'] },
      { canonical: 'CCTV-9', aliases: ['CCTV9', 'CCTV-9纪录', 'CCTV9纪录', '央视九套', '央视9套'] },
      { canonical: 'CCTV-10', aliases: ['CCTV10', 'CCTV-10科教', 'CCTV10科教', '央视十套', '央视10套'] },
      { canonical: 'CCTV-11', aliases: ['CCTV11', 'CCTV-11戏曲', 'CCTV11戏曲', '央视十一套', '央视11套'] },
      { canonical: 'CCTV-12', aliases: ['CCTV12', 'CCTV-12社会与法', 'CCTV12社会与法', '央视十二套', '央视12套'] },
      { canonical: 'CCTV-13', aliases: ['CCTV13', 'CCTV-13新闻', 'CCTV13新闻', '央视新闻'] },
      { canonical: 'CCTV-14', aliases: ['CCTV14', 'CCTV-14少儿', 'CCTV14少儿', '央视少儿'] },
      { canonical: 'CCTV-15', aliases: ['CCTV15', 'CCTV-15音乐', 'CCTV15音乐', '央视音乐'] },
      { canonical: 'CCTV-16', aliases: ['CCTV16', 'CCTV-16奥林匹克', 'CCTV16奥林匹克', '奥林匹克'] },
      { canonical: 'CCTV-17', aliases: ['CCTV17', 'CCTV-17农业农村', 'CCTV17农业农村', '央视农业农村'] },
      { canonical: 'CCTV-4K', aliases: ['CCTV4K', 'CCTV-4K超高清'] },
      { canonical: 'CCTV-8K', aliases: ['CCTV8K', 'CCTV-8K超高清'] },
      { canonical: 'CETV-1', aliases: ['中国教育电视台1套', 'CETV1', '教育1套'] },
      { canonical: 'CETV-2', aliases: ['中国教育电视台2套', 'CETV2', '教育2套'] },
      { canonical: 'CETV-4', aliases: ['中国教育电视台4套', 'CETV4', '教育4套'] },
      { canonical: '湖南卫视', aliases: ['湖南台', '芒果TV', '湖南卫星电视'] },
      { canonical: '浙江卫视', aliases: ['浙江台', '浙江卫星电视'] },
      { canonical: '江苏卫视', aliases: ['江苏台', '江苏卫星电视'] },
      { canonical: '东方卫视', aliases: ['上海卫视', '东方台', '上海东方卫视'] },
      { canonical: '北京卫视', aliases: ['北京台'] },
      { canonical: '广东卫视', aliases: ['广东台', '珠江台'] },
      { canonical: '深圳卫视', aliases: ['深圳台'] },
      { canonical: '安徽卫视', aliases: ['安徽台'] },
      { canonical: '山东卫视', aliases: ['山东台'] },
      { canonical: '湖北卫视', aliases: ['湖北台'] },
      { canonical: '河南卫视', aliases: ['河南台'] },
      { canonical: '河北卫视', aliases: ['河北台'] },
      { canonical: '辽宁卫视', aliases: ['辽宁台'] },
      { canonical: '吉林卫视', aliases: ['吉林台'] },
      { canonical: '黑龙江卫视', aliases: ['黑龙江台'] },
      { canonical: '天津卫视', aliases: ['天津台'] },
      { canonical: '重庆卫视', aliases: ['重庆台'] },
      { canonical: '四川卫视', aliases: ['四川台'] },
      { canonical: '贵州卫视', aliases: ['贵州台'] },
      { canonical: '云南卫视', aliases: ['云南台'] },
      { canonical: '广西卫视', aliases: ['广西台'] },
      { canonical: '江西卫视', aliases: ['江西台'] },
      { canonical: '东南卫视', aliases: ['东南台'] },
      { canonical: '厦门卫视', aliases: ['厦门台'] },
      { canonical: '海南卫视', aliases: ['海南台'] },
      { canonical: '陕西卫视', aliases: ['陕西台'] },
      { canonical: '山西卫视', aliases: ['山西台'] },
      { canonical: '甘肃卫视', aliases: ['甘肃台'] },
      { canonical: '宁夏卫视', aliases: ['宁夏台'] },
      { canonical: '青海卫视', aliases: ['青海台'] },
      { canonical: '新疆卫视', aliases: ['新疆台'] },
      { canonical: '西藏卫视', aliases: ['西藏台'] },
      { canonical: '内蒙古卫视', aliases: ['内蒙古台'] },
      { canonical: '兵团卫视', aliases: ['兵团台'] },
      { canonical: '三沙卫视', aliases: ['三沙台'] },
      { canonical: '大湾区卫视', aliases: ['大湾区', '广东大湾区卫视', 'GBA Satellite TV'] },
      { canonical: '康巴卫视', aliases: ['康巴藏语卫视', '康巴电视台'] },
      { canonical: '安多卫视', aliases: ['安多藏语卫视', '安多电视台'] },
      { canonical: '农林卫视', aliases: ['陕西农林卫视', '中国农林卫视'] },
      { canonical: '海峡卫视', aliases: ['福建海峡卫视', '海峡电视台'] },
      { canonical: '延边卫视', aliases: ['延边台', '延边电视台'] },
      { canonical: '旅游卫视', aliases: ['海南旅游卫视'] },
      { canonical: '山东教育卫视', aliases: ['山东教育', '山东教育电视台'] },
      { canonical: '南方卫视', aliases: ['广东南方卫视', '南方电视台'] },
      { canonical: '凤凰卫视', aliases: ['凤凰中文台', '凤凰中文', 'Phoenix Chinese Channel'] },
      { canonical: '凤凰资讯', aliases: ['凤凰资讯台', '凤凰新闻', 'Phoenix InfoNews'] },
      { canonical: '香港卫视', aliases: ['香港卫视综合台'] },
      { canonical: '澳门卫视', aliases: ['澳门卫星电视'] },
      { canonical: '澳亚卫视', aliases: ['澳亚电视', '澳亚'] },
      { canonical: '莲花卫视', aliases: ['莲花台', 'Lotus TV'] },
      { canonical: 'TVB翡翠台', aliases: ['翡翠台', 'Jade', 'TVB Jade'] },
      { canonical: 'TVB明珠台', aliases: ['明珠台', 'Pearl', 'TVB Pearl'] },
      { canonical: 'RTHK 31', aliases: ['RTHK31', '港台电视31', '港台31'] },
      { canonical: 'RTHK 32', aliases: ['RTHK32', '港台电视32', '港台32'] },
      { canonical: '中天新闻', aliases: ['中天新闻台', 'CTI News'] },
      { canonical: '中视', aliases: ['中国电视公司', 'CTV Taiwan'] },
      { canonical: '华视', aliases: ['中华电视公司', 'CTS'] },
      { canonical: '台视', aliases: ['台湾电视公司', 'TTV'] },
      { canonical: '民视', aliases: ['民间全民电视', 'FTV'] },
      { canonical: '东森新闻', aliases: ['东森新闻台', 'ETTV News'] },
      { canonical: '三立新闻', aliases: ['三立新闻台', 'SET News'] },
      { canonical: 'TVBS新闻', aliases: ['TVBS新闻台', 'TVBS News'] },
    ],
  };
}

export function loadChannelTargets(filePath = DEFAULT_CHANNEL_TARGETS_PATH): ChannelTargetsFile {
  return loadJson(filePath, defaultTargets());
}

export function loadChannelAliases(filePath = DEFAULT_CHANNEL_ALIASES_PATH): ChannelAliasesFile {
  return loadJson(filePath, defaultAliases());
}

function matchAlias(
  channelName: string,
  tokens: AliasMatchToken[],
): { canonical: string; alias: string } | null {
  const candidates = buildNormalizedChannelCandidates(channelName);
  if (candidates.length === 0) return null;
  return findBestAliasMatch(candidates, tokens);
}

function buildTargetIndex(targets: ChannelTargetsFile, aliasFile: ChannelAliasesFile) {
  const aliases = buildAliasLookup(aliasFile.aliases || []);
  const aliasMatchTokens = buildAliasMatchTokens(aliases);
  const presetList = targets.presets || [];
  const presetMap = new Map<ChannelCurationPreset, ChannelTargetPresetConfig>();
  for (const preset of presetList) {
    presetMap.set(preset.key, preset);
  }
  const resolvedPresetMap = new Map<ChannelCurationPreset, ChannelTargetPresetConfig>();
  const channelMapByPreset = new Map<ChannelCurationPreset, Map<string, { group: string; channel: string; key: string }>>();
  for (const preset of presetList) {
    const resolved = resolvePreset(preset.key, presetMap);
    if (!resolved) continue;
    resolvedPresetMap.set(preset.key, resolved);
    const channelMap = new Map<string, { group: string; channel: string; key: string }>();
    for (const item of flattenTargetChannels(resolved)) {
      const key = normalizeText(item.channel);
      channelMap.set(key, { ...item, key });
    }
    channelMapByPreset.set(preset.key, channelMap);
  }
  return { presetMap, resolvedPresetMap, channelMapByPreset, aliases, aliasMatchTokens };
}

export function matchChannelName(
  channelName: string,
  presetKey: ChannelCurationPreset,
  options?: { targetsFilePath?: string; aliasesFilePath?: string },
): ChannelNameMatch | null {
  return createChannelNameMatcher(presetKey, options)(channelName);
}

export function createChannelNameMatcher(
  presetKey: ChannelCurationPreset,
  options?: { targetsFilePath?: string; aliasesFilePath?: string },
): (channelName: string) => ChannelNameMatch | null {
  if (presetKey === 'none') return () => null;
  const targets = loadChannelTargets(options?.targetsFilePath);
  const aliasFile = loadChannelAliases(options?.aliasesFilePath);
  const index = buildTargetIndex(targets, aliasFile);
  const preset = index.resolvedPresetMap.get(presetKey);
  const channelMap = index.channelMapByPreset.get(presetKey);
  if (!preset) return () => null;
  const presetChannels = new Set(flattenTargetChannels(preset).map((item) => normalizeText(item.channel)));
  return (channelName: string): ChannelNameMatch | null => {
    const alias = matchAlias(channelName, index.aliasMatchTokens);
    const target = alias && channelMap ? channelMap.get(normalizeText(alias.canonical)) : null;
    if (!target || !presetChannels.has(target.key)) return null;
    return {
      ...target,
      matchedAlias: alias?.alias,
      matchedCanonical: alias?.canonical,
    };
  };
}

export function curateChannelEntries(
  entries: IptvPickerCoreChannelEntry[],
  presetKey: ChannelCurationPreset,
  options?: ChannelCurationOptions,
): { entries: IptvPickerCoreChannelEntry[]; summary: ChannelCurationSummary } {
  const targets = loadChannelTargets(options?.targetsFilePath);
  const aliasFile = loadChannelAliases(options?.aliasesFilePath);
  const index = buildTargetIndex(targets, aliasFile);
  const preset = index.resolvedPresetMap.get(presetKey);
  const channelMap = index.channelMapByPreset.get(presetKey);
  if (!preset) {
    return {
      entries: entries.slice(),
      summary: {
        preset: presetKey,
        keepPerChannel: 0,
        targets: 0,
        matchedTargets: 0,
        missingTargets: 0,
        candidates: 0,
        kept: entries.length,
        groups: [],
        missing: [],
      },
    };
  }

  const keepPerChannel = Math.max(1, Math.floor(
    options?.keepPerChannel ?? preset.keepPerChannel ?? 1,
  ));
  const includeUnmatched = options?.includeUnmatched ?? false;
  const includeFailed = options?.includeFailed ?? false;
  const preferredMinHeight = options?.preferredMinHeight;
  const fallbackMinHeight = options?.fallbackMinHeight;
  const allowLowResFallback = options?.allowLowResFallback ?? true;
  const targetList = flattenTargetChannels(preset);
  const presetChannels = new Set(targetList.map((item) => normalizeText(item.channel)));
  const evidenceAliasTokens = buildEvidenceAliasTokens(index.aliases, presetChannels);
  const grouped = new Map<string, {
    group: string;
    channel: string;
    key: string;
    entries: Array<{ entry: IptvPickerCoreChannelEntry; score: number; index: number }>;
    conflictRejected: number;
  }>();
  const passthrough: IptvPickerCoreChannelEntry[] = [];
  const conflictRejectedByKey = new Map<string, number>();

  entries.forEach((entry, entryIndex) => {
    const channel = entry.channel || '';
    const alias = matchAlias(channel, index.aliasMatchTokens);
    const target = alias && channelMap ? channelMap.get(normalizeText(alias.canonical)) : null;
    if (!target || !presetChannels.has(target.key)) {
      if (includeUnmatched) passthrough.push(entry);
      return;
    }
    if (!includeFailed && !entry.ok) return;
    const key = normalizeText(target.channel);
    if (hasChannelEvidenceConflict(entry, { channel: target.channel, key }, evidenceAliasTokens)) {
      conflictRejectedByKey.set(key, (conflictRejectedByKey.get(key) || 0) + 1);
      return;
    }
    const bucket = grouped.get(key) || {
      group: target.group,
      channel: target.channel,
      key,
      entries: [],
      conflictRejected: 0,
    };
    const rank = qualityRank(entry, { preferredMinHeight, fallbackMinHeight, allowLowResFallback, includeFailed });
    if (rank <= 0) return;
    bucket.entries.push({ entry, score: rank * 1_000_000_000 + scoreEntry(entry), index: entryIndex });
    grouped.set(key, bucket);
  });

  const curatedEntries: IptvPickerCoreChannelEntry[] = [];
  const groupSummaries: ChannelCurationChannelSummary[] = [];
  const missing: string[] = [];
  let candidateCount = 0;

  for (const target of targetList) {
    const key = normalizeText(target.channel);
    const bucket = grouped.get(key);
    if (!bucket || bucket.entries.length === 0) {
      missing.push(`${target.group}/${target.channel}`);
      groupSummaries.push({
        key: target.channel,
        label: target.channel,
        group: target.group,
        candidates: 0,
        kept: 0,
        bestScore: 0,
        conflictRejected: conflictRejectedByKey.get(key) || 0,
      });
      continue;
    }

    const ranked = bucket.entries
      .slice()
      .sort((a, b) => b.score - a.score || a.index - b.index);
    candidateCount += ranked.length;
    const kept = ranked.slice(0, keepPerChannel);
    for (const item of kept) {
      const rank = qualityRank(item.entry, { preferredMinHeight, fallbackMinHeight, allowLowResFallback, includeFailed });
      const quality = item.entry.ok ? qualityLabel(rank) : { value: 'unknown' as const, label: '检测失败' };
      curatedEntries.push({
        ...item.entry,
        group: target.group,
        channel: target.channel,
        curatedGroup: target.group,
        curatedChannel: target.channel,
        curationKey: presetKey,
        curationQuality: quality.value,
        curationQualityLabel: quality.label,
      } as CuratedChannelEntry);
    }
    groupSummaries.push({
      key: target.channel,
      label: target.channel,
      group: target.group,
      candidates: ranked.length,
      kept: kept.length,
      bestScore: ranked[0]?.score || 0,
      conflictRejected: conflictRejectedByKey.get(key) || 0,
    });
  }

  if (includeUnmatched) {
    curatedEntries.push(...passthrough);
  }

  const matchedTargets = groupSummaries.filter((item) => item.candidates > 0).length;
  const conflictRejected = Array.from(conflictRejectedByKey.values()).reduce((sum, count) => sum + count, 0);
  const qualityCounts = curatedEntries.reduce((counts, entry) => {
    if (entry.curationQuality === 'preferred') counts.preferredKept += 1;
    else if (entry.curationQuality === 'fallback') counts.fallbackKept += 1;
    else if (entry.curationQuality === 'low-res-fallback') counts.lowResFallbackKept += 1;
    return counts;
  }, { preferredKept: 0, fallbackKept: 0, lowResFallbackKept: 0 });
  return {
    entries: curatedEntries,
    summary: {
      preset: presetKey,
      keepPerChannel,
      preferredMinHeight,
      fallbackMinHeight,
      allowLowResFallback,
      ...qualityCounts,
      targets: targetList.length,
      matchedTargets,
      missingTargets: targetList.length - matchedTargets,
      candidates: candidateCount,
      kept: curatedEntries.length,
      conflictRejected,
      groups: groupSummaries,
      missing,
    },
  };
}
