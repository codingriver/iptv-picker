#!/usr/bin/env node

const { build } = require('esbuild');
const { rmSync } = require('fs');
const path = require('path');

const outdir = path.join(__dirname, '..', 'dist');

rmSync(outdir, { recursive: true, force: true });

build({
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  entryPoints: [
    path.join(__dirname, '..', 'src', 'iptv-picker-cli.ts'),
    path.join(__dirname, '..', 'src', 'iptv-picker-tvbox-extract-cli.ts'),
    path.join(__dirname, '..', 'src', 'iptv-picker-source-sync-cli.ts'),
  ],
  outdir,
}).then(() => {
  console.log('Build complete: dist/iptv-picker-cli.js, dist/iptv-picker-tvbox-extract-cli.js, dist/iptv-picker-source-sync-cli.js');
}).catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
