#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import {
  extractTvboxLiveSources,
  type ExtractedLiveSource,
  type TvboxConfigInputSource,
} from './core/tvbox-live-extract';

interface CliArgs {
  url?: string;
  name?: string;
  input: string;
  out: string;
  replace: boolean;
  noDedupe: boolean;
  initDefaultConfigs?: boolean;
  stdoutReport: boolean;
  quiet: boolean;
  help?: boolean;
}

const DEFAULT_INPUT_PATH = 'data/tvbox.json';
const DEFAULT_OUTPUT_PATH = 'data/source.json';

function defaultConfigCatalog() {
  return {
    generatedAt: new Date().toISOString(),
    purpose: 'Default TVBox JSON config list for extracting lives[] into live quality sources.',
    configs: [
      {
        name: 'qist tvbox 0707',
        url: 'https://raw.githubusercontent.com/qist/tvbox/master/0707.json',
        sourceKind: 'config',
      },
      {
        name: 'qist dianshi',
        url: 'https://raw.githubusercontent.com/qist/tvbox/master/dianshi.json',
        sourceKind: 'config',
      },
      {
        name: 'gxnas tvbox.json',
        url: 'https://raw.githubusercontent.com/gxnas/TvBox/main/tvbox.json',
        sourceKind: 'config',
      },
      {
        name: 'gxnas config.json',
        url: 'https://raw.githubusercontent.com/gxnas/TvBox/main/config.json',
        sourceKind: 'config',
      },
      {
        name: 'jinenge tvbox.json',
        url: 'https://raw.githubusercontent.com/jinenge/tvbox/main/tvbox.json',
        sourceKind: 'config',
      },
      {
        name: 'mrgaoshuiquan tvbox.json',
        url: 'https://raw.githubusercontent.com/mrgaoshuiquan/tvbox-config/main/tvbox.json',
        sourceKind: 'config',
      },
      {
        name: 'Reflyer823 main.json',
        url: 'https://raw.githubusercontent.com/Reflyer823/tvbox-config/master/main.json',
        sourceKind: 'config',
      },
      {
        name: 'li5bo5 2026',
        url: 'https://raw.githubusercontent.com/li5bo5/TVBox/main/2026.json',
        sourceKind: 'config',
      },
      {
        name: 'XYQ TVBox',
        url: 'https://raw.githubusercontent.com/xyq254245/xyqonlinerule/main/XYQTVBox.json',
        sourceKind: 'config',
      },
      {
        name: 'DXawi classic 0',
        url: 'https://dxawi.github.io/0/0.json',
        sourceKind: 'config',
      },
    ],
  };
}

function usage(): string {
  return [
    'Usage:',
    '  node dist/iptv-picker-tvbox-extract-cli.js --url <tvbox-json-url> [--name <name>]',
    '  node dist/iptv-picker-tvbox-extract-cli.js --input <tvbox.json>',
    '  node dist/iptv-picker-tvbox-extract-cli.js',
    '',
    'Input / output:',
    '  --url <url>                 extract lives[] from one TVBox JSON URL',
    '  --name <name>               config name for --url',
    `  --input <file>              TVBox config source list, default: ${DEFAULT_INPUT_PATH}`,
    `  --out <file>                merged live-quality sources output, default: ${DEFAULT_OUTPUT_PATH}`,
    '  --replace                   replace output file instead of merging into existing sources',
    '  --no-dedupe                 do not dedupe extracted source URLs',
    '  --init-default-configs      create the default TVBox config input file and exit',
    '  --stdout-report             print extraction summary and warnings',
    '  --quiet                     suppress progress logs',
    '',
    'Input formats:',
    '  [{"name":"qist 0707","url":"https://example.com/tvbox.json"}]',
    '  {"configs":[{"name":"qist 0707","url":"https://example.com/tvbox.json"}]}',
    '',
    'The tool extracts live source entries from TVBox JSON lives[]. It does not expand every channel.',
  ].join('\n');
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    input: DEFAULT_INPUT_PATH,
    out: DEFAULT_OUTPUT_PATH,
    replace: false,
    noDedupe: false,
    stdoutReport: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item === '--help' || item === '-h') args.help = true;
    else if (item === '--url') args.url = argv[++i];
    else if (item === '--name') args.name = argv[++i];
    else if (item === '--input') args.input = argv[++i];
    else if (item === '--out' || item === '-o') args.out = argv[++i];
    else if (item === '--replace') args.replace = true;
    else if (item === '--no-dedupe') args.noDedupe = true;
    else if (item === '--init-default-configs') args.initDefaultConfigs = true;
    else if (item === '--stdout-report') args.stdoutReport = true;
    else if (item === '--quiet' || item === '-q') args.quiet = true;
    else throw new Error(`Unknown argument: ${item}`);
  }
  return args;
}

function ensureDefaultConfigFile(filePath: string): void {
  if (existsSync(filePath)) return;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(defaultConfigCatalog(), null, 2), 'utf8');
}

function loadConfigSources(args: CliArgs): TvboxConfigInputSource[] {
  if (args.url) {
    return [{
      name: args.name?.trim() || args.url,
      url: args.url.trim(),
    }];
  }

  const file = resolve(args.input);
  if (file === resolve(DEFAULT_INPUT_PATH)) ensureDefaultConfigFile(file);
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  const raw = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.configs)
      ? parsed.configs
      : Array.isArray(parsed.sources)
        ? parsed.sources
        : [];

  return raw
    .map((item: { name?: unknown; url?: unknown; content?: unknown; enabled?: unknown }) => ({
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : String(item.url || 'config'),
      url: typeof item.url === 'string' ? item.url.trim() : '',
      content: typeof item.content === 'string' ? item.content : undefined,
      enabled: item.enabled !== false,
    }))
    .filter((source: TvboxConfigInputSource) => !!source.url);
}

function readExistingOutput(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {
      generatedAt: new Date().toISOString(),
      purpose: 'Live quality source list.',
      sources: [],
    };
  }
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function mergeSources(
  existing: Record<string, unknown>,
  extracted: ExtractedLiveSource[],
  replace: boolean,
): { output: Record<string, unknown>; added: number; skippedDuplicate: number } {
  const currentSources = replace
    ? []
    : Array.isArray(existing.sources)
      ? existing.sources as Array<Record<string, unknown>>
      : [];
  const seen = new Set(currentSources
    .map((source) => typeof source.url === 'string' ? source.url.toLowerCase() : '')
    .filter(Boolean));
  const sources = currentSources.slice();
  let added = 0;
  let skippedDuplicate = 0;

  for (const source of extracted) {
    const key = source.url.toLowerCase();
    if (seen.has(key)) {
      skippedDuplicate++;
      continue;
    }
    sources.push({ ...source });
    seen.add(key);
    added++;
  }

  const notes = Array.isArray(existing.notes) ? existing.notes.slice() : [];
  const note = 'TVBox JSON lives[] entries were extracted and merged by iptv-picker-tvbox-extract.';
  if (!notes.includes(note)) notes.push(note);

  return {
    output: {
      ...existing,
      generatedAt: new Date().toISOString(),
      purpose: typeof existing.purpose === 'string' ? existing.purpose : 'Live quality source list.',
      notes,
      sources,
    },
    added,
    skippedDuplicate,
  };
}

function printReport(summary: unknown, warnings: unknown[]): void {
  console.log(JSON.stringify({ summary, warnings }, null, 2));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.initDefaultConfigs) {
    ensureDefaultConfigFile(resolve(DEFAULT_INPUT_PATH));
    console.log(`[iptv-picker-tvbox-extract] Default config source file ready: ${DEFAULT_INPUT_PATH}`);
    return;
  }

  const configs = loadConfigSources(args);
  if (configs.length === 0) throw new Error('No TVBox config sources provided. Use --url or --input.\n' + usage());
  if (!args.quiet) console.log(`[iptv-picker-tvbox-extract] Extracting lives[] from ${configs.length} config(s)...`);

  const result = await extractTvboxLiveSources(configs, { dedupe: !args.noDedupe });
  const out = resolve(args.out);
  const existing = args.replace ? {} : readExistingOutput(out);
  const merged = mergeSources(existing, result.sources, args.replace);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(merged.output, null, 2), 'utf8');

  const report = {
    ...result.summary,
    outputFile: out,
    addedToOutput: merged.added,
    skippedOutputDuplicates: merged.skippedDuplicate,
    outputTotalSources: Array.isArray(merged.output.sources) ? merged.output.sources.length : 0,
  };

  if (args.stdoutReport) printReport(report, result.warnings);
  if (!args.quiet) {
    console.log(`[iptv-picker-tvbox-extract] Extracted ${result.sources.length} live source(s), added ${merged.added}, skipped duplicates ${merged.skippedDuplicate}`);
    console.log(`[iptv-picker-tvbox-extract] Wrote ${out}`);
    if (result.warnings.length) console.log(`[iptv-picker-tvbox-extract] Warnings: ${result.warnings.length} (use --stdout-report for details)`);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[iptv-picker-tvbox-extract] ${msg}`);
  process.exit(1);
});


