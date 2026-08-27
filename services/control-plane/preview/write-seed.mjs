import { partialSourceFailureSql, previewSeedSql } from './seed.mjs';
import { writeFile } from 'node:fs/promises';

function usage() {
  process.stderr.write('usage: node preview/write-seed.mjs [--scenario partial-source-failure] [--output <file>]\n');
  process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  let scenario = 'normal';
  let output;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === '--scenario' && value === 'partial-source-failure' && scenario === 'normal') {
      scenario = value;
    } else if (flag === '--output' && value && output === undefined) {
      output = value;
    } else {
      usage();
      return;
    }
  }
  const sql = scenario === 'partial-source-failure' ? partialSourceFailureSql : previewSeedSql;
  if (!output) {
    process.stdout.write(sql);
    return;
  }
  await writeFile(output, sql);
  process.stdout.write('Wrote synthetic preview SQL locally; no Cloudflare action was performed.\n');
}

main().catch((error) => {
  process.stderr.write(`preview seed render failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
