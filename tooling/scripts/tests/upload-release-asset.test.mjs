import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../upload-release-asset.mjs', import.meta.url))

test('the documented installer glob selects its matching release asset before any upload', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tono-upload-glob-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const bin = path.join(dir, 'bin')
  mkdirSync(bin)
  const gh = path.join(bin, 'gh')
  writeFileSync(gh, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const root = path.dirname(__dirname);
const args = process.argv.slice(2);
if (args[0] === 'api') {
  process.stdout.write(JSON.stringify({ draft: false, assets: [{ name: 'Tono_0.0.74_x64-setup.exe', size: 1 }] }));
} else if (args.slice(0, 2).join(' ') === 'release download') {
  fs.writeFileSync(path.join(root, 'selected-asset'), args[args.indexOf('--pattern') + 1]);
  process.exit(99); // Stop before even a fixture download, and never reach upload.
} else process.exit(98);
`)
  chmodSync(gh, 0o755)
  const npx = path.join(bin, 'npx')
  writeFileSync(npx, `#!${process.execPath}\nrequire('node:fs').writeFileSync(require('node:path').join(require('node:path').dirname(__dirname), 'upload-attempt'), 'refused'); process.exit(97);\n`)
  chmodSync(npx, 0o755)
  const result = spawnSync(process.execPath, [script, '--tag', 'v0.0.74', '--pattern', 'Tono_*.exe'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  })
  assert.equal(existsSync(path.join(dir, 'selected-asset')), true, result.stderr)
  assert.equal(existsSync(path.join(dir, 'upload-attempt')), false)
})
