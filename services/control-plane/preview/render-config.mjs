import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderPreviewConfigs } from './config.mjs';

const expected = new Set([
  'PREVIEW_D1_DATABASE_ID',
  'PREVIEW_ADMIN_HOSTNAME',
  'PREVIEW_DIAGNOSTICS_BUCKET',
  'PREVIEW_RELEASES_BUCKET',
]);

function usage() {
  throw new Error('usage: node preview/render-config.mjs --env-file <ignored-preview-env> --output-dir <directory>');
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--env-file', '--output-dir'].includes(flag) || !value || values[flag]) usage();
    values[flag] = value;
  }
  if (!values['--env-file'] || !values['--output-dir']) usage();
  return values;
}

function parseEnvironment(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('preview env lines must use KEY=value');
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!expected.has(key) || key in values) throw new Error(`unexpected or duplicate preview env key: ${key}`);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  for (const key of expected) {
    if (!(key in values)) throw new Error(`missing preview env key: ${key}`);
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = await readFile(resolve(args['--env-file']), 'utf8');
  const environment = parseEnvironment(source);
  const configs = renderPreviewConfigs({
    d1DatabaseId: environment.PREVIEW_D1_DATABASE_ID,
    adminHostname: environment.PREVIEW_ADMIN_HOSTNAME,
    diagnosticsBucket: environment.PREVIEW_DIAGNOSTICS_BUCKET,
    releasesBucket: environment.PREVIEW_RELEASES_BUCKET,
  });
  const outputDirectory = resolve(args['--output-dir']);
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(`${outputDirectory}/wrangler.preview.generated.jsonc`, `${JSON.stringify(configs.api, null, 2)}\n`),
    writeFile(`${outputDirectory}/wrangler.preview.admin.generated.jsonc`, `${JSON.stringify(configs.admin, null, 2)}\n`),
  ]);
  process.stdout.write('Rendered isolated preview Wrangler configs locally; no Cloudflare action was performed.\n');
}

main().catch((error) => {
  process.stderr.write(`preview config render failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
