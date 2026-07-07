#!/usr/bin/env node

const { createHash } = require('crypto');
const { existsSync, readFileSync, writeFileSync } = require('fs');
const { gzipSync } = require('zlib');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, 'src', 'core', 'bundled-ffprobe.ts');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function writeStub(outFile) {
  writeFileSync(outFile, [
    'export interface BundledFfprobeAsset {',
    '  platform: NodeJS.Platform;',
    '  arch: NodeJS.Architecture;',
    '  filename: string;',
    '  sha256: string;',
    '  gzipBase64: string;',
    '}',
    '',
    'export function getBundledFfprobeAsset(): BundledFfprobeAsset | undefined {',
    '  return undefined;',
    '}',
    '',
  ].join('\n'), 'utf8');
}

function chunkString(value, size = 120) {
  const chunks = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}

function writeAsset(inputFile, outFile, platform, arch) {
  if (!existsSync(inputFile)) throw new Error(`ffprobe binary not found: ${inputFile}`);
  const bytes = readFileSync(inputFile);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const gzipBase64 = gzipSync(bytes, { level: 9 }).toString('base64');
  const chunks = chunkString(gzipBase64);
  const filename = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  writeFileSync(outFile, [
    'export interface BundledFfprobeAsset {',
    '  platform: NodeJS.Platform;',
    '  arch: NodeJS.Architecture;',
    '  filename: string;',
    '  sha256: string;',
    '  gzipBase64: string;',
    '}',
    '',
    'const gzipBase64 = [',
    ...chunks.map((chunk) => `  '${chunk}',`),
    "].join('');",
    '',
    'export function getBundledFfprobeAsset(): BundledFfprobeAsset | undefined {',
    '  return {',
    `    platform: '${platform}' as NodeJS.Platform,`,
    `    arch: '${arch}' as NodeJS.Architecture,`,
    `    filename: '${filename}',`,
    `    sha256: '${sha256}',`,
    '    gzipBase64,',
    '  };',
    '}',
    '',
  ].join('\n'), 'utf8');
  console.log(`[bundled-ffprobe] generated ${outFile}`);
  console.log(`[bundled-ffprobe] source ${inputFile}`);
  console.log(`[bundled-ffprobe] sha256 ${sha256}`);
}

function main() {
  const outFile = path.resolve(argValue('--out') || DEFAULT_OUT);
  if (hasArg('--stub')) {
    writeStub(outFile);
    console.log(`[bundled-ffprobe] restored stub ${outFile}`);
    return;
  }
  const input = argValue('--input') || process.env.FFPROBE_EXE;
  if (!input) throw new Error('Use --input <ffprobe.exe> or FFPROBE_EXE=<file>.');
  const platform = argValue('--platform') || process.platform;
  const arch = argValue('--arch') || process.arch;
  writeAsset(path.resolve(input), outFile, platform, arch);
}

main();
