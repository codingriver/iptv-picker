#!/usr/bin/env node

const { spawnSync } = require('child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');
const path = require('path');
const { buildSync } = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, 'data', 'backups');
const DIST_CLI = path.join(ROOT, 'dist', 'iptv-picker-cli.js');

const FILES = {
  input: path.join(BACKUP_DIR, 'channel-curation-regression-source.json'),
  output: path.join(BACKUP_DIR, 'channel-curation-regression-result.json'),
  log: path.join(BACKUP_DIR, 'channel-curation-regression.log'),
  preflight: path.join(BACKUP_DIR, 'channel-curation-regression-preflight.json'),
  coreBundle: path.join(BACKUP_DIR, 'channel-curation-core.cjs'),
  mergeTargets: path.join(BACKUP_DIR, 'channel-curation-merge-targets.json'),
  cycleTargets: path.join(BACKUP_DIR, 'channel-curation-cycle-targets.json'),
  overrideStrategy: path.join(BACKUP_DIR, 'channel-curation-override-strategy.json'),
};

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runCli() {
  const result = spawnSync('node', [
    DIST_CLI,
    '--input', FILES.input,
    '--out', FILES.output,
    '--st', 'fast',
    '--preset', 'cn',
    '--pipeline-mode', 'stage',
    '--preflight-timeout-ms', '50',
    '--check-timeout-ms', '100',
    '--check-retry', '0',
    '--log-out', FILES.log,
    '--preflight-out', FILES.preflight,
    '--no-report',
    '--no-md-reports',
    '--no-progress-output',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    timeout: 120000,
  });

  assert(result.status === 0, `CLI failed:\n${result.stdout}\n${result.stderr}`);
}

function writeFixture() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const m3u = [
    '#EXTM3U',
    '#EXTINF:-1 group-title="回归测试",CCTV1',
    'http://127.0.0.1:9/live/cctv1.m3u8',
    '#EXTINF:-1 group-title="回归测试",CCTV-1 (1080p)',
    'http://127.0.0.1:9/live/cctv1-1080p.m3u8',
    '#EXTINF:-1 group-title="回归测试",CCTV5+',
    'http://127.0.0.1:9/live/cctv5plus.m3u8',
    '#EXTINF:-1 group-title="回归测试",CCTV10',
    'http://127.0.0.1:9/live/cctv10.m3u8',
    '#EXTINF:-1 group-title="回归测试",CCTV-10 (720p)',
    'http://127.0.0.1:9/live/cctv10-720p.m3u8',
    '#EXTINF:-1 group-title="回归测试",CCTV11',
    'http://127.0.0.1:9/live/cctv11.m3u8',
    '#EXTINF:-1 group-title="回归测试",CCTV12',
    'http://127.0.0.1:9/live/cctv12.m3u8',
    '#EXTINF:-1 group-title="回归测试",CCTV13',
    'http://127.0.0.1:9/live/cctv13.m3u8',
    '#EXTINF:-1 group-title="回归测试",CCTV13 8M1080',
    'http://127.0.0.1:9/live/cctv13-8m1080.m3u8',
    '#EXTINF:-1 group-title="回归测试",CCTV14',
    'http://127.0.0.1:9/live/cctv14.m3u8',
    '#EXTINF:-1 group-title="回归测试",CCTV15',
    'http://127.0.0.1:9/live/cctv15.m3u8',
    '#EXTINF:-1 group-title="回归测试",CCTV16',
    'http://127.0.0.1:9/live/cctv16.m3u8',
    '#EXTINF:-1 group-title="回归测试",CCTV16-4K',
    'http://127.0.0.1:9/live/cctv16-4k.m3u8',
    '#EXTINF:-1 group-title="回归测试",CCTV17',
    'http://127.0.0.1:9/live/cctv17.m3u8',
    '#EXTINF:-1 group-title="回归测试",CCTV4K',
    'http://127.0.0.1:9/live/cctv4k.m3u8',
    '#EXTINF:-1 group-title="回归测试",CCTV-4K (1080p)',
    'http://127.0.0.1:9/live/cctv4k-1080p.m3u8',
    '#EXTINF:-1 group-title="回归测试",CCTV8K',
    'http://127.0.0.1:9/live/cctv8k.m3u8',
    '#EXTINF:-1 group-title="回归测试",CCTV-8K (1080p)',
    'http://127.0.0.1:9/live/cctv8k-1080p.m3u8',
    '#EXTINF:-1 group-title="回归测试",CETV1 (576p)',
    'http://127.0.0.1:9/live/cetv1-576p.m3u8',
    '#EXTINF:-1 group-title="回归测试",Беларусь 5',
    'http://127.0.0.1:9/live/belarus5.m3u8',
  ].join('\n');

  writeFileSync(FILES.input, JSON.stringify([{
    name: '频道规则回归测试',
    url: 'https://example.com/channel-curation-regression.m3u',
    content: m3u,
    sourceKind: 'custom',
  }], null, 2), 'utf8');
}

function assertLog() {
  assert(existsSync(FILES.log), `Log file was not created: ${FILES.log}`);
  const log = readFileSync(FILES.log, 'utf8');

  const expectedMatches = [
    ['CCTV1', 'CCTV-1'],
    ['CCTV-1 (1080p)', 'CCTV-1'],
    ['CCTV5+', 'CCTV-5+'],
    ['CCTV10', 'CCTV-10'],
    ['CCTV-10 (720p)', 'CCTV-10'],
    ['CCTV11', 'CCTV-11'],
    ['CCTV12', 'CCTV-12'],
    ['CCTV13', 'CCTV-13'],
    ['CCTV13 8M1080', 'CCTV-13'],
    ['CCTV14', 'CCTV-14'],
    ['CCTV15', 'CCTV-15'],
    ['CCTV16', 'CCTV-16'],
    ['CCTV16-4K', 'CCTV-16'],
    ['CCTV17', 'CCTV-17'],
    ['CCTV4K', 'CCTV-4K'],
    ['CCTV-4K (1080p)', 'CCTV-4K'],
    ['CCTV8K', 'CCTV-8K'],
    ['CCTV-8K (1080p)', 'CCTV-8K'],
    ['CETV1 (576p)', 'CETV-1'],
  ];

  for (const [raw, target] of expectedMatches) {
    assert(
      new RegExp(`\\[规则命中\\].*\\[原始频道:${escapeRegExp(raw)}\\].*\\[目标频道:${escapeRegExp(target)}\\]`).test(log),
      `Expected ${raw} to match ${target}`,
    );
  }

  assert(
    /\[规则未命中\].*\[原始频道:Беларусь 5\]/.test(log),
    'Expected Беларусь 5 to stay unmatched',
  );

  const badPatterns = [
    /\[规则命中\] \[原始频道:CCTV5\+\] \[目标频道:CCTV-5\]/,
    /\[规则命中\] \[原始频道:CCTV10\] \[目标频道:CCTV-1\]/,
    /\[规则命中\] \[原始频道:CCTV11\] \[目标频道:CCTV-1\]/,
    /\[规则命中\] \[原始频道:CCTV12\] \[目标频道:CCTV-1\]/,
    /\[规则命中\] \[原始频道:CCTV13\] \[目标频道:CCTV-1\]/,
    /\[规则命中\] \[原始频道:CCTV14\] \[目标频道:CCTV-1\]/,
    /\[规则命中\] \[原始频道:CCTV15\] \[目标频道:CCTV-1\]/,
    /\[规则命中\] \[原始频道:CCTV16\] \[目标频道:CCTV-1\]/,
    /\[规则命中\] \[原始频道:CCTV17\] \[目标频道:CCTV-1\]/,
    /\[规则命中\] \[原始频道:CCTV4K\] \[目标频道:CCTV-4\]/,
    /\[规则命中\] \[原始频道:CCTV8K\] \[目标频道:CCTV-8\]/,
    /\[规则命中\] \[原始频道:Беларусь 5\]/,
  ];

  for (const pattern of badPatterns) {
    assert(!pattern.test(log), `Unexpected broad channel match: ${pattern}`);
  }
}

function qualityEntry(channel, url) {
  return {
    bareUrl: url,
    ok: true,
    engine: 'ffprobe-fast',
    checkedAt: new Date(0).toISOString(),
    resolution: '3840x2160',
    bitrate: 8000000,
    fps: 50,
    formatName: 'hls',
    sourceName: '频道规则回归测试',
    sourceUrl: 'https://example.com/channel-curation-regression.m3u',
    channel,
    group: '回归测试',
  };
}

function assertFinalCuration() {
  buildSync({
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    entryPoints: [path.join(ROOT, 'src', 'core', 'channel-curation.ts')],
    outfile: FILES.coreBundle,
  });

  delete require.cache[require.resolve(FILES.coreBundle)];
  const { curateChannelEntries, matchChannelName } = require(FILES.coreBundle);

  const expectedMatches = [
    ['CCTV1', 'CCTV-1'],
    ['CCTV-1综合HD', 'CCTV-1'],
    ['CCTV-1 (1080p)', 'CCTV-1'],
    ['CCTV1 8M1080', 'CCTV-1'],
    ['CCTV5+', 'CCTV-5+'],
    ['CCTV5+体育赛事HD', 'CCTV-5+'],
    ['CCTV10', 'CCTV-10'],
    ['CCTV-10科教HD', 'CCTV-10'],
    ['CCTV-10 (720p)', 'CCTV-10'],
    ['CCTV11', 'CCTV-11'],
    ['CCTV12', 'CCTV-12'],
    ['CCTV13', 'CCTV-13'],
    ['CCTV13 8M1080', 'CCTV-13'],
    ['CCTV14', 'CCTV-14'],
    ['CCTV15', 'CCTV-15'],
    ['CCTV16', 'CCTV-16'],
    ['CCTV16-4K', 'CCTV-16'],
    ['CCTV17', 'CCTV-17'],
    ['CCTV4K', 'CCTV-4K'],
    ['CCTV-4K (1080p)', 'CCTV-4K'],
    ['CCTV8K', 'CCTV-8K'],
    ['CCTV-8K (1080p)', 'CCTV-8K'],
    ['CETV1 (576p)', 'CETV-1'],
    ['CETV2 HD', 'CETV-2'],
  ];
  for (const [raw, expected] of expectedMatches) {
    const matched = matchChannelName(raw, 'cn');
    assert(matched?.channel === expected, `Expected ${raw} to match ${expected}, got ${matched?.channel || 'null'}`);
  }

  const expansionExpectations = [
    ['大湾区卫视', 'cn', null],
    ['大湾区卫视', 'cn-full', '大湾区卫视'],
    ['大湾区卫视', 'cn-plus', '大湾区卫视'],
    ['凤凰卫视', 'cn', null],
    ['凤凰卫视', 'cn-full', null],
    ['凤凰卫视', 'cn-plus', '凤凰卫视'],
    ['TVB翡翠台', 'cn-plus', 'TVB翡翠台'],
    ['中天新闻', 'cn-plus', '中天新闻'],
  ];
  for (const [raw, preset, expected] of expansionExpectations) {
    const matched = matchChannelName(raw, preset);
    assert(
      (matched?.channel || null) === expected,
      `Expected ${raw} with ${preset} to match ${expected || 'null'}, got ${matched?.channel || 'null'}`,
    );
  }

  const entries = [
    qualityEntry('CCTV4K', 'http://example.test/live/cctv4k_36m.m3u8'),
    qualityEntry('CCTV8K', 'http://example.test/live/cctv8k_120m.m3u8'),
    qualityEntry('CCTV-4', 'http://example.test/live/cctv4.m3u8'),
    qualityEntry('CCTV-8', 'http://example.test/live/cctv8.m3u8'),
    qualityEntry('CCTV-4', 'http://example.test/live/cctv4k_wrong_label.m3u8'),
    qualityEntry('CCTV-8', 'http://example.test/live/cctv8k_wrong_label.m3u8'),
  ];
  const result = curateChannelEntries(entries, 'cn', { keepPerChannel: 3 });
  const summaryByKey = new Map(result.summary.groups.map((item) => [item.key, item]));

  assert(summaryByKey.get('CCTV-4K')?.candidates === 1, 'Expected CCTV-4K to remain a final curation candidate');
  assert(summaryByKey.get('CCTV-4K')?.kept === 1, 'Expected CCTV-4K to be kept in final curation');
  assert(summaryByKey.get('CCTV-8K')?.candidates === 1, 'Expected CCTV-8K to remain a final curation candidate');
  assert(summaryByKey.get('CCTV-8K')?.kept === 1, 'Expected CCTV-8K to be kept in final curation');
  assert(summaryByKey.get('CCTV-4')?.conflictRejected === 1, 'Expected CCTV-4 evidence conflict to reject CCTV-4K URL');
  assert(summaryByKey.get('CCTV-8')?.conflictRejected === 1, 'Expected CCTV-8 evidence conflict to reject CCTV-8K URL');

  const qualityResult = curateChannelEntries([
    { ...qualityEntry('CCTV-1', 'http://example.test/live/one-low.m3u8'), resolution: '854x480' },
    { ...qualityEntry('CCTV-1', 'http://example.test/live/one-mid.m3u8'), resolution: '1280x720' },
    { ...qualityEntry('CCTV-1', 'http://example.test/live/one-high.m3u8'), resolution: '1920x1080' },
    { ...qualityEntry('CCTV-2', 'http://example.test/live/two-low.m3u8'), resolution: '854x480' },
  ], 'cn', {
    keepPerChannel: 1,
    preferredMinHeight: 1080,
    fallbackMinHeight: 720,
    allowLowResFallback: true,
  });
  const qualityByChannel = new Map(qualityResult.entries.map((entry) => [entry.channel, entry]));
  assert(qualityByChannel.get('CCTV-1')?.bareUrl.endsWith('one-high.m3u8'), 'Expected CCTV-1 to prefer 1080P line');
  assert(qualityByChannel.get('CCTV-1')?.curationQuality === 'preferred', 'Expected CCTV-1 to be marked as preferred');
  assert(qualityByChannel.get('CCTV-2')?.bareUrl.endsWith('two-low.m3u8'), 'Expected CCTV-2 to keep low-res fallback for coverage');
  assert(qualityByChannel.get('CCTV-2')?.curationQuality === 'low-res-fallback', 'Expected CCTV-2 to be marked as low-res fallback');

  const noLowFallback = curateChannelEntries([
    { ...qualityEntry('CCTV-2', 'http://example.test/live/two-low.m3u8'), resolution: '854x480' },
  ], 'cn', {
    keepPerChannel: 1,
    preferredMinHeight: 1080,
    fallbackMinHeight: 720,
    allowLowResFallback: false,
  });
  assert(!noLowFallback.entries.some((entry) => entry.channel === 'CCTV-2'), 'Expected low-res line to be dropped when fallback is disabled');

  const cnEmpty = curateChannelEntries([], 'cn');
  const cnFullEmpty = curateChannelEntries([], 'cn-full');
  const cnPlusEmpty = curateChannelEntries([], 'cn-plus');
  assert(cnEmpty.summary.targets === 58, `Expected cn to expand to 58 targets, got ${cnEmpty.summary.targets}`);
  assert(cnFullEmpty.summary.targets === 67, `Expected cn-full to expand to 67 targets, got ${cnFullEmpty.summary.targets}`);
  assert(cnPlusEmpty.summary.targets === 85, `Expected cn-plus to expand to 85 targets, got ${cnPlusEmpty.summary.targets}`);

  writeFileSync(FILES.mergeTargets, JSON.stringify({
    defaultPreset: 'cn',
    presets: [
      {
        key: 'cn',
        label: '基础',
        description: '基础',
        groups: [{ name: '卫视', channels: ['湖南卫视'] }],
      },
      {
        key: 'cn-full',
        label: '扩展',
        description: '扩展',
        extends: ['cn'],
        groups: [{ name: '卫视', channels: ['湖南卫视', '大湾区卫视'] }],
      },
    ],
  }, null, 2), 'utf8');
  const merged = curateChannelEntries([], 'cn-full', { targetsFilePath: FILES.mergeTargets });
  assert(merged.summary.targets === 2, `Expected merged same-name group to dedupe channels to 2 targets, got ${merged.summary.targets}`);

  writeFileSync(FILES.cycleTargets, JSON.stringify({
    defaultPreset: 'cn',
    presets: [
      { key: 'cn', label: 'A', description: 'A', extends: ['cn-full'], groups: [] },
      { key: 'cn-full', label: 'B', description: 'B', extends: ['cn'], groups: [] },
    ],
  }, null, 2), 'utf8');
  let cycleThrown = false;
  try {
    matchChannelName('湖南卫视', 'cn', { targetsFilePath: FILES.cycleTargets });
  } catch (err) {
    cycleThrown = /extends cycle/.test(String(err && err.message || err));
  }
  assert(cycleThrown, 'Expected preset extends cycle to throw a clear error');
}

function assertCliPresetOverride() {
  writeFileSync(FILES.overrideStrategy, JSON.stringify({
    defaultStrategy: 'fast-bound',
    channelCuration: { defaultPreset: 'none' },
    strategies: [
      {
        key: 'fast-bound',
        label: '覆盖测试',
        description: '策略内绑定 cn-full，但命令行应覆盖为 cn-plus。',
        enabled: true,
        filters: { status: 'ok' },
        sort: { entry: 'default', entryDir: 'asc', report: 'ok-rate', reportDir: 'desc' },
        export: { exportAll: false },
        runtime: {
          downloadTimeoutMs: 15000,
          checkTimeoutMs: 100,
          checkRetry: 0,
          checkMode: 'fast',
          pipelineMode: 'stage',
          preflight: true,
          preflightTimeoutMs: 50,
          hostTimeoutLimit: 3,
          sourceParallel: 1,
          preflightParallel: 5,
          preflightHostParallel: 2,
          checkParallel: 5,
          checkHostParallel: 1,
        },
        curation: {
          preset: 'cn-full',
          keepPerChannel: 1,
          preFilter: true,
          includeUnmatched: false,
          includeFailed: false,
        },
      },
    ],
  }, null, 2), 'utf8');

  const result = spawnSync('node', [
    DIST_CLI,
    '--input', FILES.input,
    '--out', FILES.output,
    '--strategy-file', FILES.overrideStrategy,
    '--st', 'fast-bound',
    '--preset', 'cn-plus',
    '--no-report',
    '--no-md-reports',
    '--no-progress-output',
    '--nolog',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    timeout: 120000,
  });

  assert(result.status === 0, `CLI override check failed:\n${result.stdout}\n${result.stderr}`);
  const output = JSON.parse(readFileSync(FILES.output, 'utf8'));
  assert(output.output?.channelCurationPreset === 'cn-plus', `Expected CLI --preset to override strategy preset to cn-plus, got ${output.output?.channelCurationPreset}`);
}

function main() {
  assert(existsSync(DIST_CLI), `CLI bundle not found. Run npm run build first: ${DIST_CLI}`);
  writeFixture();
  runCli();
  assertLog();
  assertFinalCuration();
  assertCliPresetOverride();
  console.log(`[channel-curation-regression] passed: ${FILES.log}`);
}

main();
