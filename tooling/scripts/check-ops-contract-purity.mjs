#!/usr/bin/env node
// The ops contract may depend on exactly one thing: `src/errors.ts`.
//
// The console imports these types through its `@contract` tsconfig path, so a
// single `import type { Env }` or a D1 helper reaching into the contract drags
// `@cloudflare/workers-types` — and the Worker's runtime — into a browser
// build. That failure shows up as an inscrutable bundler error weeks later, on
// somebody else's change. A regex over the import statements catches it on the
// commit that introduced it, which is worth more than being clever.
//
// What is allowed:
//   src/ops/http.ts          → ../errors
//   src/ops/contract.ts      → ../errors, ./contract/<sibling>
//   src/ops/contract/*.ts    → ../../errors, ./<sibling>
//
// Specifiers are resolved against the importing file, so the depth of the
// relative path is not something the rule has to know about.
//
// Usage: node tooling/scripts/check-ops-contract-purity.mjs [--root <dir>]

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..', '..');

/** The files under guard, relative to the repository root. */
export const GUARDED = [
  'services/control-plane/src/ops/contract.ts',
  'services/control-plane/src/ops/http.ts',
  'services/control-plane/src/ops/contract/*.ts',
];

const ERRORS_MODULE = 'services/control-plane/src/errors';

// Every form that can pull another module in. `[^;]*?` keeps a match inside one
// statement, so a lazy scan cannot run from one `export` to some later `from`.
const SPECIFIER_PATTERNS = [
  /^[ \t]*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm,
  /^[ \t]*import\s*['"]([^'"]+)['"]/gm,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Blank out comments (keeping line numbers) so prose about an import is not one. */
function stripNonCode(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) => lead + ' '.repeat(match.length - lead.length));
}

const withoutExtension = (file) => file.replace(/\.(ts|tsx|mts|js|mjs)$/, '');

/**
 * Every import in `source` that the rule does not allow, as
 * `{ line, lineNumber, specifier }`.
 */
export function forbiddenImports(source, relativePath) {
  const code = stripNonCode(source);
  const lines = source.split('\n');
  const dir = path.posix.dirname(relativePath);
  const inContractFolder = dir.endsWith('/src/ops/contract');
  const offenders = [];
  const matches = SPECIFIER_PATTERNS.flatMap((pattern) => [...code.matchAll(pattern)])
    .sort((a, b) => a.index - b.index);
  for (const match of matches) {
    const specifier = match[1];
    const resolved = specifier.startsWith('.')
      ? withoutExtension(path.posix.normalize(path.posix.join(dir, specifier)))
      : specifier;
    if (resolved === ERRORS_MODULE) continue;
    // Siblings: contract.ts reaches into its own folder, the folder's files
    // reach across it. Nothing else in src/ops is a sibling.
    const sibling = inContractFolder
      ? resolved.startsWith(`${dir}/`)
      : resolved.startsWith(`${dir}/contract/`);
    if (sibling && resolved !== relativePath) continue;
    const lineNumber = source.slice(0, match.index).split('\n').length;
    offenders.push({
      lineNumber,
      specifier,
      line: (lines[lineNumber - 1] ?? '').trim(),
    });
  }
  return offenders;
}

function expand(root, pattern) {
  if (!pattern.endsWith('/*.ts')) return [pattern];
  const dir = pattern.slice(0, -'/*.ts'.length);
  return readdirSync(path.join(root, dir))
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => `${dir}/${name}`);
}

export function checkPurity(root, patterns = GUARDED) {
  const findings = [];
  for (const pattern of patterns) {
    for (const relativePath of expand(root, pattern)) {
      const source = readFileSync(path.join(root, relativePath), 'utf8');
      for (const offender of forbiddenImports(source, relativePath)) {
        findings.push({ file: relativePath, ...offender });
      }
    }
  }
  return findings;
}

function main(argv) {
  const rootFlag = argv.indexOf('--root');
  const root = rootFlag === -1 ? DEFAULT_ROOT : path.resolve(argv[rootFlag + 1]);
  const findings = checkPurity(root);
  if (findings.length === 0) {
    console.log('ops contract is pure: only src/errors.ts and siblings are imported');
    return 0;
  }
  console.error('The ops contract may only import src/errors.ts and its own siblings.');
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.lineNumber}: ${finding.line}`);
  }
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
