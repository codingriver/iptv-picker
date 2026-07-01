#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const isWindows = process.platform === 'win32';
const cliPath = path.join(root, 'dist', 'iptv-picker-cli.js');
const cliArgs = process.argv.slice(2);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: options.shell === true,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function runNpm(args) {
  if (isWindows) {
    run(`npm ${args.join(' ')}`, [], { shell: true });
  } else {
    run('npm', args);
  }
}

runNpm(['install']);
runNpm(['run', 'build']);
run(process.execPath, [cliPath, ...cliArgs]);
