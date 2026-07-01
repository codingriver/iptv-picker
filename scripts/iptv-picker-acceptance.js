#!/usr/bin/env node

const { spawnSync } = require('child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, 'data', 'backups');
const DIST_CLI = path.join(ROOT, 'dist', 'iptv-picker-cli.js');
const SAMPLE_SIZE = Math.max(10, Number(process.env.IPTV_PICKER_ACCEPTANCE_SAMPLE_SIZE || 20) || 20);
const EDGE_SAMPLE_SIZE = Math.min(5, SAMPLE_SIZE);

const FILES = {
  sources: path.join(BACKUP_DIR, 'external-quality-acceptance-sources.json'),
  txtSources: path.join(BACKUP_DIR, 'external-quality-acceptance-txt-sources.json'),
  edgeSources: path.join(BACKUP_DIR, 'external-quality-acceptance-edge-sources.json'),
  fullOutput: path.join(BACKUP_DIR, 'external-quality-acceptance-full.json'),
  fullSourceStats: path.join(BACKUP_DIR, 'external-quality-acceptance-full.source-stats.md'),
  fullChannelStats: path.join(BACKUP_DIR, 'external-quality-acceptance-full.channel-stats.md'),
  iptvOrgOutput: path.join(BACKUP_DIR, 'external-quality-acceptance-iptv-org.json'),
  okOutput: path.join(BACKUP_DIR, 'external-quality-acceptance-ok.json'),
  okM3u: path.join(BACKUP_DIR, 'external-quality-acceptance-ok.m3u'),
  failedOutput: path.join(BACKUP_DIR, 'external-quality-acceptance-failed.json'),
  txtOutput: path.join(BACKUP_DIR, 'external-quality-acceptance-txt.json'),
  txtLive: path.join(BACKUP_DIR, 'external-quality-acceptance-txt-live.txt'),
  edgeOutput: path.join(BACKUP_DIR, 'external-quality-acceptance-edge.json'),
  reportJson: path.join(BACKUP_DIR, 'external-quality-acceptance-report.json'),
  reportHtml: path.join(BACKUP_DIR, 'external-quality-acceptance-report.html'),
  screenshot: path.join(BACKUP_DIR, 'external-quality-acceptance-report.png'),
};

const OPEN_SOURCES = [
  {
    name: 'Free-TV acceptance',
    repo: 'https://github.com/Free-TV/IPTV',
    url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',
  },
  {
    name: 'iptv-org acceptance',
    repo: 'https://github.com/iptv-org/iptv',
    url: 'https://iptv-org.github.io/iptv/countries/cn.m3u',
  },
];

const cases = [];

function log(message) {
  console.log(`[acceptance] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function run(command, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    ...options,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    durationMs: Date.now() - started,
  };
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function pushCase(name, status, details) {
  cases.push({ name, status, details });
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'iptv-picker-acceptance-test/1.0' },
    });
    assert(response.ok, `Fetch failed: ${url} -> HTTP ${response.status}`);
    const text = await response.text();
    assert(text.includes('#EXTM3U') || text.includes('#EXTINF'), `Fetched source is not an M3U playlist: ${url}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function parseM3uItems(content, limit) {
  const lines = content.split(/\r?\n/);
  const items = [];
  let pendingExtinf = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      pendingExtinf = line;
      continue;
    }
    if (line.startsWith('#')) continue;
    if (pendingExtinf && /^(https?|rtp|rtsp|udp):\/\//i.test(line)) {
      const groupMatch = pendingExtinf.match(/group-title="([^"]+)"/i);
      const comma = pendingExtinf.lastIndexOf(',');
      items.push({
        name: comma >= 0 ? pendingExtinf.slice(comma + 1).trim() || `channel-${items.length + 1}` : `channel-${items.length + 1}`,
        group: groupMatch ? groupMatch[1] : 'Acceptance',
        url: line,
        extinf: pendingExtinf,
      });
      pendingExtinf = null;
      if (items.length >= limit) break;
    }
  }

  assert(items.length > 0, 'No playable URL found in sampled M3U content');
  return items;
}

function itemsToM3u(items) {
  return ['#EXTM3U', ...items.flatMap((item) => [item.extinf, item.url])].join('\n');
}

function itemsToDiyTxt(items) {
  const groups = new Map();
  for (const item of items) {
    const group = item.group || 'Acceptance';
    const list = groups.get(group) || [];
    list.push(item);
    groups.set(group, list);
  }
  const lines = [];
  for (const [group, list] of groups) {
    lines.push(`${group},#genre#`);
    for (const item of list) {
      lines.push(`${item.name},${item.url}`);
    }
  }
  return lines.join('\n');
}

async function prepareSources() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const sources = [];
  const parsedByName = {};

  for (const source of OPEN_SOURCES) {
    log(`fetch ${source.name}: ${source.url}`);
    const content = await fetchText(source.url);
    const items = parseM3uItems(content, SAMPLE_SIZE);
    parsedByName[source.name] = items;
    log(`sample ${source.name}: ${items.length} URL(s)`);
    sources.push({
      name: source.name,
      url: source.url,
      content: itemsToM3u(items),
      sourceKind: 'custom',
    });
  }

  const txtItems = parsedByName['iptv-org acceptance'].slice(0, EDGE_SAMPLE_SIZE);
  const txtSources = [{
    name: 'iptv-org DIYP TXT acceptance',
    url: 'https://iptv-org.github.io/iptv/index.m3u#diyp-derived',
    content: itemsToDiyTxt(txtItems),
    sourceKind: 'custom',
  }];

  const edgeSources = [
    {
      name: 'Invalid M3U linter edge',
      url: 'https://example.invalid/invalid.m3u',
      content: '#EXTM3U\n#EXTINF:-1 Broken Channel\n',
      sourceKind: 'custom',
    },
    {
      name: 'Download failure edge',
      url: 'https://example.com/not-a-real-iptv-source.m3u',
      sourceKind: 'custom',
    },
  ];

  writeFileSync(FILES.sources, JSON.stringify(sources, null, 2), 'utf8');
  writeFileSync(FILES.txtSources, JSON.stringify(txtSources, null, 2), 'utf8');
  writeFileSync(FILES.edgeSources, JSON.stringify(edgeSources, null, 2), 'utf8');

  return { sources, txtSources, edgeSources };
}

function runCli(label, args, outputFile, timeout = 240000) {
  log(label);
  const cli = run('node', [DIST_CLI, ...args, '--out', outputFile], { timeout });
  assert(cli.code === 0, `${label} failed:\n${cli.stdout}\n${cli.stderr}`);
  assert(existsSync(outputFile), `${label} did not create output: ${outputFile}`);
  const json = readJson(outputFile);
  assert(json.status?.state === 'done', `${label} expected status.state=done`);
  assert(Array.isArray(json.entries), `${label} expected entries[]`);
  assert(json.report && Array.isArray(json.report.sources), `${label} expected report.sources[]`);
  pushCase(label, 'PASS', {
    durationMs: cli.durationMs,
    checkedUrls: json.status.checkedUrls,
    okUrls: json.status.okUrls,
    failedUrls: json.status.failedUrls,
    outputEntries: json.entries.length,
  });
  return json;
}

function assertEntriesHaveIptvChecker(result, label) {
  assert(result.entries.length > 0, `${label} expected entries`);
  for (const entry of result.entries) {
    assert(entry.engine === 'iptv-checker', `${label} expected engine=iptv-checker`);
    assert(typeof entry.bareUrl === 'string' && entry.bareUrl.length > 0, `${label} expected bareUrl`);
    assert(typeof entry.ok === 'boolean', `${label} expected ok boolean`);
    assert(typeof entry.checkedAt === 'string' && entry.checkedAt.length > 0, `${label} expected checkedAt`);
  }
}

function assertSortedByResolutionDesc(entries) {
  const heights = entries.map((entry) => {
    const match = String(entry.resolution || '').match(/\d+\s*x\s*(\d+)/i);
    return match ? Number(match[1]) : 0;
  });
  for (let i = 1; i < heights.length; i++) {
    assert(heights[i - 1] >= heights[i], 'Expected resolution desc sorting');
  }
}

function assertSortedByError(entries) {
  const values = entries.map((entry) => String(entry.errorCode || '').toLowerCase());
  for (let i = 1; i < values.length; i++) {
    assert(values[i - 1].localeCompare(values[i], 'zh-CN') <= 0, 'Expected error asc sorting');
  }
}

function validateFullResult(result) {
  assert(result.status.totalSources === OPEN_SOURCES.length, 'Full result expected two open-source playlists');
  assert(result.status.checkedUrls >= SAMPLE_SIZE * OPEN_SOURCES.length, 'Full result checked too few URLs');
  assert(result.status.okUrls > 0, 'Full result expected at least one playable URL');
  assert(result.status.failedUrls > 0, 'Full result expected at least one failed URL');
  assert(result.report.totalSources === OPEN_SOURCES.length, 'Full report expected two source summaries');
  assertEntriesHaveIptvChecker(result, 'Full result');
}

function validateIptvOrgFilter(result) {
  assert(result.output?.filtered === true, 'Filtered output expected output.filtered=true');
  assert(result.output.filters?.source === 'iptv-org', 'Filtered output expected source filter metadata');
  assert(result.entries.every((entry) => String(entry.sourceName || '').includes('iptv-org')), 'Filtered output should only contain iptv-org entries');
  assert(result.report.okUrls > 0, 'Filtered iptv-org report expected playable URLs');
  assertSortedByResolutionDesc(result.entries);
}

function validateOkFilter(result) {
  assert(result.entries.length > 0, 'OK filter expected at least one entry');
  assert(result.entries.every((entry) => entry.ok === true), 'OK filter expected only ok=true entries');
  assert(result.report.failedUrls === 0, 'OK filter report expected failedUrls=0');
}

function validateFailedFilter(result) {
  assert(result.entries.length > 0, 'Failed filter expected at least one entry');
  assert(result.entries.every((entry) => entry.ok === false), 'Failed filter expected only ok=false entries');
  assert(result.report.okUrls === 0, 'Failed filter report expected okUrls=0');
  assertSortedByError(result.entries);
}

function validateTxtResult(result) {
  assert(result.status.checkedUrls >= EDGE_SAMPLE_SIZE, 'TXT result checked too few URLs');
  assert(result.entries.every((entry) => String(entry.sourceName || '').includes('DIYP TXT')), 'TXT result expected DIYP TXT source name');
  assertEntriesHaveIptvChecker(result, 'TXT result');
}

function validateEdgeResult(result) {
  const errorCodes = new Set(result.entries.map((entry) => entry.errorCode));
  assert(errorCodes.has('LINT_FAILED'), 'Edge result expected LINT_FAILED');
  assert(errorCodes.has('SOURCE_DOWNLOAD_FAILED'), 'Edge result expected SOURCE_DOWNLOAD_FAILED');
  assert(result.entries.every((entry) => entry.ok === false), 'Edge result expected only failures');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function summarizeErrors(result) {
  const counts = new Map();
  for (const entry of result.entries) {
    if (entry.ok) continue;
    const code = entry.errorCode || 'UNKNOWN';
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

function buildReportPayload(results, sourceInfo) {
  return {
    generatedAt: new Date().toISOString(),
    sampleSizePerOpenSource: SAMPLE_SIZE,
    edgeSampleSize: EDGE_SAMPLE_SIZE,
    openSources: OPEN_SOURCES.map((source) => ({ name: source.name, repo: source.repo, url: source.url })),
    files: FILES,
    cases,
    summary: {
      full: {
        totalSources: results.full.status.totalSources,
        checkedUrls: results.full.status.checkedUrls,
        okUrls: results.full.status.okUrls,
        failedUrls: results.full.status.failedUrls,
        durationMs: results.full.status.durationMs,
      },
      iptvOrgFiltered: {
        outputEntries: results.iptvOrg.entries.length,
        okUrls: results.iptvOrg.report.okUrls,
        failedUrls: results.iptvOrg.report.failedUrls,
      },
      okFiltered: {
        outputEntries: results.ok.entries.length,
      },
      failedFiltered: {
        outputEntries: results.failed.entries.length,
        errorCodes: summarizeErrors(results.failed),
      },
      txtDerived: {
        checkedUrls: results.txt.status.checkedUrls,
        okUrls: results.txt.status.okUrls,
        failedUrls: results.txt.status.failedUrls,
      },
      edgeCases: {
        checkedUrls: results.edge.status.checkedUrls,
        errorCodes: summarizeErrors(results.edge),
      },
    },
    sourceInfo: {
      openSourceCount: sourceInfo.sources.length,
      txtDerivedCount: sourceInfo.txtSources.length,
      edgeSourceCount: sourceInfo.edgeSources.length,
    },
  };
}

function writeHtmlReport(payload, results) {
  const errorRows = payload.summary.failedFiltered.errorCodes
    .map(([code, count]) => `<tr><td>${escapeHtml(code)}</td><td>${count}</td></tr>`)
    .join('');
  const caseRows = payload.cases
    .map((item) => `<tr><td>${escapeHtml(item.name)}</td><td class="${item.status === 'PASS' ? 'pass' : 'fail'}">${item.status}</td><td>${escapeHtml(JSON.stringify(item.details))}</td></tr>`)
    .join('');
  const sourceRows = payload.openSources
    .map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.repo)}</td><td>${escapeHtml(item.url)}</td></tr>`)
    .join('');
  const okRows = results.ok.entries.slice(0, 8)
    .map((entry) => `<tr><td>${escapeHtml(entry.channel)}</td><td>${escapeHtml(entry.group)}</td><td>${escapeHtml(entry.resolution || '-')}</td><td>${escapeHtml(entry.codec || '-')}</td><td>${escapeHtml(entry.bareUrl)}</td></tr>`)
    .join('');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>IPTV Picker CLI 验收报告</title>
  <style>
    body { margin: 0; font-family: Arial, "Microsoft YaHei", sans-serif; color: #17202a; background: #f5f7f9; }
    .page { max-width: 1180px; margin: 0 auto; padding: 28px; }
    h1 { margin: 0 0 6px; font-size: 26px; letter-spacing: 0; }
    h2 { margin: 26px 0 10px; font-size: 18px; letter-spacing: 0; }
    .meta { color: #53616f; font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-top: 18px; }
    .metric { background: #fff; border: 1px solid #dce3ea; border-radius: 6px; padding: 12px; }
    .metric b { display: block; font-size: 24px; margin-bottom: 4px; }
    .metric span { color: #5a6875; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #dce3ea; border-radius: 6px; overflow: hidden; table-layout: fixed; }
    th, td { padding: 9px 10px; border-bottom: 1px solid #e6ebf0; text-align: left; font-size: 12px; vertical-align: top; word-break: break-all; }
    th { background: #edf2f6; color: #2d3a45; }
    tr:last-child td { border-bottom: 0; }
    .pass { color: #0f7a3a; font-weight: 700; }
    .fail { color: #b42318; font-weight: 700; }
    .note { background: #fff; border-left: 4px solid #3867d6; padding: 12px; margin-top: 14px; color: #384756; }
  </style>
</head>
<body>
  <div class="page">
    <h1>IPTV Picker CLI 验收报告</h1>
    <div class="meta">Generated at ${escapeHtml(payload.generatedAt)} · sample size ${payload.sampleSizePerOpenSource} per open-source playlist · engine iptv-checker + ffprobe</div>
    <div class="grid">
      <div class="metric"><b>${payload.summary.full.checkedUrls}</b><span>真实开源 URL 检测数</span></div>
      <div class="metric"><b>${payload.summary.full.okUrls}</b><span>可播放 URL</span></div>
      <div class="metric"><b>${payload.summary.full.failedUrls}</b><span>失败 URL</span></div>
      <div class="metric"><b>${payload.summary.okFiltered.outputEntries}</b><span>ok 过滤输出</span></div>
      <div class="metric"><b>${payload.cases.length}</b><span>验收用例数</span></div>
    </div>
    <div class="note">验收覆盖：开源 M3U 下载、m3u-linter 预检、iptv-checker 播放检测、TXT/DIYP 转换、失败源、非法 M3U、过滤、排序、源级统计排序、交互 TTY 保护。</div>

    <h2>开源 IPTV 源</h2>
    <table><thead><tr><th>名称</th><th>仓库</th><th>Playlist</th></tr></thead><tbody>${sourceRows}</tbody></table>

    <h2>验收用例</h2>
    <table><thead><tr><th style="width:240px">用例</th><th style="width:80px">结果</th><th>细节</th></tr></thead><tbody>${caseRows}</tbody></table>

    <h2>失败错误码分布</h2>
    <table><thead><tr><th>errorCode</th><th>数量</th></tr></thead><tbody>${errorRows}</tbody></table>

    <h2>可播放样例</h2>
    <table><thead><tr><th>频道</th><th>分组</th><th>分辨率</th><th>Codec</th><th>URL</th></tr></thead><tbody>${okRows}</tbody></table>
  </div>
</body>
</html>`;
  writeFileSync(FILES.reportHtml, html, 'utf8');
}

async function screenshotReport() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(FILES.reportHtml).href);
    await page.screenshot({ path: FILES.screenshot, fullPage: true });
  } finally {
    await browser.close();
  }
  assert(existsSync(FILES.screenshot), `Screenshot was not created: ${FILES.screenshot}`);
}

async function main() {
  log('start full IPTV Picker acceptance test');

  log('check ffprobe');
  const ffprobe = run('ffprobe', ['-version']);
  assert(ffprobe.code === 0, 'ffprobe is required but was not found in PATH');
  pushCase('ffprobe runtime check', 'PASS', { command: 'ffprobe -version' });

  log('build project');
  const build = run('node', [path.join('scripts', 'build.js')], { stdio: 'pipe' });
  assert(build.code === 0, `Build failed:\n${build.stdout}\n${build.stderr}`);
  assert(existsSync(DIST_CLI), `CLI bundle not found: ${DIST_CLI}`);
  pushCase('project build', 'PASS', { outfile: DIST_CLI, durationMs: build.durationMs });

  log('check CLI help');
  const help = run('node', [DIST_CLI, '--help']);
  assert(help.code === 0, `CLI help failed:\n${help.stdout}\n${help.stderr}`);
  assert(help.stdout.includes('--interactive'), 'Help output should include --interactive');
  assert(help.stdout.includes('--report-sort'), 'Help output should include --report-sort');
  assert(help.stdout.includes('--export-live'), 'Help output should include --export-live');
  assert(help.stdout.includes('--export-format'), 'Help output should include --export-format');
  pushCase('CLI help', 'PASS', { interactive: true, reportSort: true, exportLive: true });

  log('check non-TTY interactive guard');
  const interactive = run('node', [DIST_CLI, '--interactive']);
  assert(interactive.code !== 0, 'Interactive mode should fail in non-TTY acceptance test');
  assert((interactive.stderr + interactive.stdout).includes('terminal TTY'), 'Interactive guard should mention terminal TTY');
  pushCase('interactive non-TTY guard', 'PASS', { exitCode: interactive.code });

  const sourceInfo = await prepareSources();
  pushCase('fetch and sample open-source playlists', 'PASS', {
    sources: OPEN_SOURCES.length,
    sampleSizePerOpenSource: SAMPLE_SIZE,
  });

  const results = {};

  results.full = runCli('full real open-source M3U check', [
    '--input', FILES.sources,
    '--sort', 'default',
    '--report-sort', 'ok-rate',
    '--report-sort-dir', 'desc',
    '--source-stats-out', FILES.fullSourceStats,
    '--channel-stats-out', FILES.fullChannelStats,
  ], FILES.fullOutput);
  validateFullResult(results.full);
  const fullSourceStats = readFileSync(FILES.fullSourceStats, 'utf8');
  const fullChannelStats = readFileSync(FILES.fullChannelStats, 'utf8');
  assert(fullSourceStats.includes('# 直播源统计报告'), 'Source stats report should include Chinese title');
  assert(fullSourceStats.includes('| 直播源 |'), 'Source stats report should include source table');
  assert(fullChannelStats.includes('# 产出频道统计报告'), 'Channel stats report should include Chinese title');
  assert(fullChannelStats.includes('| 分组 | 频道 |'), 'Channel stats report should include channel table');
  assert(results.full.pipeline?.steps?.every((item) => typeof item.durationMs === 'number'), 'JSON pipeline steps should include durationMs');
  assert(results.full.timing?.totals?.checkMs >= 0, 'JSON timing totals should include checker timing');
  pushCase('markdown stats report generation', 'PASS', { sourceStats: FILES.fullSourceStats, channelStats: FILES.fullChannelStats });

  results.iptvOrg = runCli('source filter + resolution sort check', [
    '--input', FILES.sources,
    '--source', 'iptv-org',
    '--sort', 'resolution',
    '--sort-dir', 'desc',
    '--report-sort', 'ok-rate',
    '--report-sort-dir', 'desc',
  ], FILES.iptvOrgOutput);
  validateIptvOrgFilter(results.iptvOrg);

  results.ok = runCli('ok status filter check', [
    '--input', FILES.sources,
    '--status', 'ok',
    '--sort', 'bitrate',
    '--sort-dir', 'desc',
    '--export-live', FILES.okM3u,
  ], FILES.okOutput);
  validateOkFilter(results.ok);
  const okM3u = readFileSync(FILES.okM3u, 'utf8');
  assert(okM3u.startsWith('#EXTM3U'), 'M3U live export should start with #EXTM3U');
  assert(okM3u.includes('#EXTINF'), 'M3U live export should include #EXTINF rows');
  assert(results.ok.output?.liveExport?.format === 'm3u', 'OK output should include m3u liveExport metadata');
  assert(results.ok.output?.liveExport?.entries === results.ok.entries.length, 'M3U live export entries should match OK entries');
  pushCase('M3U live export', 'PASS', { file: FILES.okM3u, entries: results.ok.output.liveExport.entries });

  results.failed = runCli('failed status filter + error sort check', [
    '--input', FILES.sources,
    '--status', 'failed',
    '--sort', 'error',
  ], FILES.failedOutput);
  validateFailedFilter(results.failed);

  results.txt = runCli('DIYP TXT conversion check', [
    '--input', FILES.txtSources,
    '--sort', 'channel',
    '--export-live', FILES.txtLive,
    '--export-format', 'txt',
  ], FILES.txtOutput);
  validateTxtResult(results.txt);
  const txtLive = readFileSync(FILES.txtLive, 'utf8');
  assert(txtLive.includes(',#genre#'), 'TXT live export should include DIYP group markers');
  assert(results.txt.output?.liveExport?.format === 'txt', 'TXT output should include txt liveExport metadata');
  pushCase('TXT live export', 'PASS', { file: FILES.txtLive, entries: results.txt.output.liveExport.entries });

  results.edge = runCli('edge cases: invalid M3U + download failure', [
    '--input', FILES.edgeSources,
    '--status', 'failed',
    '--sort', 'error',
  ], FILES.edgeOutput);
  validateEdgeResult(results.edge);

  const payload = buildReportPayload(results, sourceInfo);
  writeFileSync(FILES.reportJson, JSON.stringify(payload, null, 2), 'utf8');
  writeHtmlReport(payload, results);
  await screenshotReport();
  pushCase('HTML report screenshot', 'PASS', { html: FILES.reportHtml, screenshot: FILES.screenshot });
  payload.cases = cases;
  writeFileSync(FILES.reportJson, JSON.stringify(payload, null, 2), 'utf8');

  log(`passed: checked=${results.full.status.checkedUrls}, ok=${results.full.status.okUrls}, failed=${results.full.status.failedUrls}`);
  log(`report: ${FILES.reportHtml}`);
  log(`screenshot: ${FILES.screenshot}`);
}

main().catch((err) => {
  console.error(`[acceptance] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
