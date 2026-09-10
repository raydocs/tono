import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GENERATED_FIXTURE_FILES,
  generateOpsFixtures,
} from '../scripts/generate-ops-fixtures.mjs';

/**
 * The committed fixtures are the pages' and Playwright specs' source of
 * truth. Regenerating them must not rewrite a single byte, so the generator
 * is held to a byte-for-byte copy of each file it is allowed to emit.
 */
const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const outDir = mkdtempSync(join(tmpdir(), 'ops-fixtures-'));

beforeAll(() => {
  generateOpsFixtures(outDir);
});

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe('the ops fixture generator reproduces the committed files', () => {
  it('emits exactly the files it claims, and no others', () => {
    expect([...GENERATED_FIXTURE_FILES].sort()).toEqual(
      readdirSync(outDir).filter((name) => name.endsWith('.json')).sort(),
    );
  });

  for (const name of GENERATED_FIXTURE_FILES) {
    it(name, () => {
      const got = readFileSync(join(outDir, name));
      const want = readFileSync(join(FIXTURES, name));
      expect(got.equals(want), `${name} drifted from the committed fixture`).toBe(true);
    });
  }
});
