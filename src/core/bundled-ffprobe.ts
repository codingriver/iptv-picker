export interface BundledFfprobeAsset {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  filename: string;
  sha256: string;
  gzipBase64: string;
}

export function getBundledFfprobeAsset(): BundledFfprobeAsset | undefined {
  return undefined;
}
