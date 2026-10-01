// Picks the Windows App, Core and Service that an NSIS installer installs, from a
// 7-Zip extraction of that installer, for desktop-update-v1.mjs measure.
//
// The installer carries the payload more than once: the installed copy (App and
// Core at the root, helpers under resources/) and, since #658, a pre-install gate
// copy of every resource under $PLUGINSDIR/tono-gate/. Each component is taken by
// its exact installed path, never by a name search, and any other copy of a
// component anywhere in the package must be byte-identical to the installed one;
// otherwise the package is refused rather than measured.
import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const INSTALLED = { app: 'Tono.exe.next', core: 'tono-core.exe.next', privileged: 'resources/tono-service.exe' }

// Installed location for a file carrying a component's name, or null.
function installedPath(name) {
  if (/^tono\.exe\.next$/i.test(name)) return INSTALLED.app
  if (/^tono-core\.exe\.next$/i.test(name)) return INSTALLED.core
  if (/^tono-service[A-Za-z0-9._-]*\.exe$/i.test(name)) return `resources/${name}`
  return null
}

async function listFiles(root, relative = '') {
  const found = []
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name
    const info = await lstat(path.join(root, child))
    if (info.isSymbolicLink()) throw new Error(`${child} is a link; refusing the package`)
    if (info.isDirectory()) found.push(...await listFiles(root, child))
    else if (info.isFile()) found.push(child)
    else throw new Error(`${child} is not a regular file; refusing the package`)
  }
  return found
}

const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex')

export async function windowsPackageComponents(root) {
  const files = await listFiles(root)
  const byPath = new Map()
  for (const file of files) {
    const key = file.toLowerCase()
    if (byPath.has(key)) throw new Error(`${file} appears twice with different case`)
    byPath.set(key, file)
  }
  const installed = expected => {
    const file = byPath.get(expected.toLowerCase())
    if (!file) throw new Error(`the package has no installed ${expected}`)
    return file
  }
  for (const file of files) {
    const expected = installedPath(path.posix.basename(file))
    if (!expected) continue
    const reference = installed(expected)
    if (reference !== file && await digest(path.join(root, file)) !== await digest(path.join(root, reference))) {
      throw new Error(`${file} differs from the installed ${reference}; refusing the package`)
    }
  }
  return Object.fromEntries(Object.entries(INSTALLED).map(([role, expected]) => [role, path.join(root, installed(expected))]))
}

async function main() {
  const [root, ...rest] = process.argv.slice(2)
  if (!root || rest.length) throw new Error('usage: windows-package-components.mjs <7-Zip extraction of the NSIS installer>')
  const { app, core, privileged } = await windowsPackageComponents(path.resolve(root))
  // KEY=path lines for GITHUB_ENV; nothing else goes to stdout.
  console.log(`WINDOWS_APP=${app}\nWINDOWS_CORE=${core}\nWINDOWS_SERVICE=${privileged}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`[windows-package-components] ${error.message}`)
    process.exitCode = 1
  })
}
