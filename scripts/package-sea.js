#!/usr/bin/env node

const { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } = require('fs');
const { join, resolve } = require('path');
const { spawnSync } = require('child_process');

const ROOT = resolve(__dirname, '..');
const BUNDLED_MODULE = join(ROOT, 'src', 'core', 'bundled-ffprobe.ts');
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function platformName(platform = process.platform) {
  if (platform === 'win32') return 'windows';
  if (platform === 'windows') return 'windows';
  if (platform === 'darwin') return 'macos';
  if (platform === 'macos') return 'macos';
  return platform;
}

function exeName(platform = process.platform) {
  return normalizePlatform(platform) === 'win32' ? 'iptv-picker.exe' : 'iptv-picker';
}

function targetName(platform = process.platform, arch = process.arch) {
  return `${platformName(platform)}-${releaseArchName(arch)}`;
}

function normalizePlatform(platform) {
  if (platform === 'windows') return 'win32';
  if (platform === 'macos') return 'darwin';
  return platform;
}

function normalizeArch(arch) {
  if (arch === 'x86') return 'ia32';
  return arch;
}

function releaseArchName(arch) {
  return normalizeArch(arch) === 'ia32' ? 'x86' : normalizeArch(arch);
}

function envFlag(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined || value === '') return defaultValue;
  return /^(1|true|yes|on)$/i.test(value);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    const detail = result.error ? `: ${result.error.message}` : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}${detail}`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
  });
  return result.status === 0 ? (result.stdout || '').trim() : '';
}

function commandExists(command) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  return capture(locator, [command]).split(/\r?\n/).some(Boolean);
}

function findFfprobe() {
  if (process.env.FFPROBE_EXE && existsSync(process.env.FFPROBE_EXE)) return resolve(process.env.FFPROBE_EXE);
  const where = process.platform === 'win32'
    ? capture('where.exe', ['ffprobe'])
    : capture('which', ['ffprobe']);
  const first = where.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  if (first && existsSync(first)) return first;
  throw new Error('ffprobe was not found. Set FFPROBE_EXE to a target-platform ffprobe binary and retry.');
}

function maybeFindFfprobe() {
  if (!envFlag('BUNDLE_FFPROBE', true)) return undefined;
  try {
    return findFfprobe();
  } catch (error) {
    if (envFlag('ALLOW_MISSING_FFPROBE')) {
      console.warn(`[package:sea] ${error.message}`);
      console.warn('[package:sea] continuing without bundled ffprobe; runtime will use no-ffmpeg fallback unless external ffprobe is available.');
      return undefined;
    }
    throw error;
  }
}

function postjectCommand() {
  const cli = join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js');
  if (!existsSync(cli)) throw new Error('postject is not installed. Run npm install first.');
  return { command: process.execPath, argsPrefix: [cli] };
}

function restoreBundledStub() {
  run(process.execPath, [
    join(ROOT, 'scripts', 'prepare-bundled-ffprobe.js'),
    '--stub',
    '--out',
    BUNDLED_MODULE,
  ]);
}

function maybeUnsignMacosBinary(file, targetPlatform = process.platform) {
  if (targetPlatform !== 'darwin' || process.platform !== 'darwin') return;
  if (!commandExists('codesign')) return;
  run('codesign', ['--remove-signature', file]);
}

function maybeSignMacosBinary(file, targetPlatform = process.platform) {
  if (targetPlatform !== 'darwin' || process.platform !== 'darwin') return;
  if (!commandExists('codesign')) return;
  run('codesign', ['--sign', '-', file]);
}

function main() {
  const platform = normalizePlatform(process.env.TARGET_PLATFORM || process.platform);
  const arch = normalizeArch(process.env.TARGET_ARCH || process.arch);
  const nodeBinary = resolve(process.env.NODE_SEA_BINARY || process.execPath);
  if (!['win32', 'linux', 'darwin'].includes(platform)) {
    throw new Error(`Unsupported SEA release platform: ${platform}`);
  }
  if (!['x64', 'arm64', 'ia32'].includes(arch)) {
    throw new Error(`Unsupported SEA release arch: ${arch}`);
  }
  if (arch === 'ia32' && platform !== 'win32') {
    throw new Error('Only Windows x86/ia32 SEA releases are supported.');
  }
  if (platform !== process.platform) {
    throw new Error(`Cross-OS SEA packaging is not supported. Host=${process.platform}, target=${platform}.`);
  }
  if (arch !== process.arch && nodeBinary === process.execPath) {
    throw new Error(`TARGET_ARCH=${releaseArchName(arch)} requires NODE_SEA_BINARY pointing to a target-arch Node executable.`);
  }
  if (!existsSync(nodeBinary)) {
    throw new Error(`Node SEA binary was not found: ${nodeBinary}`);
  }

  const target = targetName(platform, arch);
  const releaseDir = join(ROOT, 'release', target);
  const tmpDir = join(ROOT, '.tmp', 'sea', target);
  const seaConfig = join(tmpDir, 'sea-config.json');
  const seaBlob = join(tmpDir, 'iptv-picker.blob');
  const executable = join(releaseDir, exeName(platform));
  const ffprobe = maybeFindFfprobe();

  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(releaseDir, { recursive: true });

  try {
    if (ffprobe) {
      run(process.execPath, [
        join(ROOT, 'scripts', 'prepare-bundled-ffprobe.js'),
        '--input',
        ffprobe,
        '--platform',
        platform,
        '--arch',
        arch,
        '--out',
        BUNDLED_MODULE,
      ]);
    } else {
      restoreBundledStub();
    }
    run(process.execPath, [join(ROOT, 'scripts', 'build.js')]);

    writeFileSync(seaConfig, JSON.stringify({
      main: join(ROOT, 'dist', 'iptv-picker-cli.js'),
      output: seaBlob,
      disableExperimentalSEAWarning: true,
      useCodeCache: false,
      useSnapshot: false,
    }, null, 2), 'utf8');

    run(nodeBinary, ['--experimental-sea-config', seaConfig]);
    copyFileSync(nodeBinary, executable);
    maybeUnsignMacosBinary(executable, platform);

    const postject = postjectCommand();
    const postjectArgs = [
      ...postject.argsPrefix,
      executable,
      'NODE_SEA_BLOB',
      seaBlob,
      '--sentinel-fuse',
      SEA_FUSE,
    ];
    if (platform === 'darwin') postjectArgs.push('--macho-segment-name', 'NODE_SEA');
    run(postject.command, postjectArgs);
    maybeSignMacosBinary(executable, platform);

    console.log(`[package:sea] target ${target}`);
    console.log(`[package:sea] node ${nodeBinary}`);
    console.log(`[package:sea] ffprobe ${ffprobe || 'not bundled'}`);
    console.log(`[package:sea] wrote ${executable}`);
  } finally {
    restoreBundledStub();
  }
}

main();
