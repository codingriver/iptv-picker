const { readFileSync } = require('fs');
const { resolve } = require('path');

const ROOT = resolve(__dirname, '..');
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function normalizeVersion(value) {
  const version = String(value || '').trim().replace(/^v(?=\d)/, '');
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid application version: ${value || '(empty)'}`);
  }
  return version;
}

function packageVersion() {
  const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  return packageJson.version;
}

function resolveAppVersion() {
  return normalizeVersion(process.env.APP_VERSION || packageVersion());
}

module.exports = {
  normalizeVersion,
  resolveAppVersion,
};
