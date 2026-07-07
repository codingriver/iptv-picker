#!/usr/bin/env node

if (process.platform !== 'win32') {
  throw new Error('package:win must run on a Windows runner. Use npm run package:sea on the target platform.');
}

require('./package-sea');
