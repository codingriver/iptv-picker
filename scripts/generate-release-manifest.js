#!/usr/bin/env node

const { createReadStream } = require('fs');
const { readdir, readFile, stat, writeFile } = require('fs/promises');
const { createHash } = require('crypto');
const { join, resolve } = require('path');

function releaseAssetName(name) {
  return name.endsWith('.zip') || name.endsWith('.tar.gz');
}

function hashFile(file) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(file);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolveHash(hash.digest('hex')));
  });
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/%2F/gi, '/');
}

async function readNotes(file) {
  if (!file) return '';
  try {
    return (await readFile(file, 'utf8')).trimEnd();
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

async function main() {
  const releaseDir = resolve(process.argv[2] || process.env.RELEASE_DIR || 'release');
  const tag = String(process.env.RELEASE_TAG || '').trim();
  const repository = String(process.env.RELEASE_REPOSITORY || process.env.GITHUB_REPOSITORY || '').trim();
  const notesFile = process.env.RELEASE_NOTES_FILE
    ? resolve(process.env.RELEASE_NOTES_FILE)
    : join(releaseDir, 'release-notes.md');

  if (!tag) throw new Error('RELEASE_TAG is required.');
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new Error('RELEASE_REPOSITORY must use the owner/repository format.');
  }

  const names = (await readdir(releaseDir))
    .filter(releaseAssetName)
    .sort((left, right) => left.localeCompare(right, 'en'));
  if (names.length === 0) {
    throw new Error(`No .zip or .tar.gz release assets found in ${releaseDir}.`);
  }

  const encodedTag = encodePathSegment(tag);
  const releaseBaseUrl = `https://github.com/${repository}/releases`;
  const downloadBaseUrl = `${releaseBaseUrl}/download/${encodedTag}`;
  const assets = [];

  for (const name of names) {
    const file = join(releaseDir, name);
    const [metadata, sha256] = await Promise.all([stat(file), hashFile(file)]);
    if (!metadata.isFile()) continue;
    assets.push({
      name,
      url: `${downloadBaseUrl}/${encodePathSegment(name)}`,
      size: metadata.size,
      sha256,
    });
  }

  const checksumContents = assets
    .map((asset) => `${asset.sha256}  ${asset.name}`)
    .join('\n');
  await writeFile(join(releaseDir, 'SHA256SUMS.txt'), `${checksumContents}\n`, 'utf8');

  const manifest = {
    version: tag.replace(/^v(?=\d)/, ''),
    releaseUrl: `${releaseBaseUrl}/tag/${encodedTag}`,
    notes: await readNotes(notesFile),
    checksumUrl: `${downloadBaseUrl}/SHA256SUMS.txt`,
    assets,
  };
  await writeFile(join(releaseDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`[release-manifest] version ${manifest.version}`);
  console.log(`[release-manifest] assets ${assets.length}`);
  console.log(`[release-manifest] wrote ${join(releaseDir, 'SHA256SUMS.txt')}`);
  console.log(`[release-manifest] wrote ${join(releaseDir, 'latest.json')}`);
}

main().catch((error) => {
  console.error(`[release-manifest] ${error.message}`);
  process.exit(1);
});
