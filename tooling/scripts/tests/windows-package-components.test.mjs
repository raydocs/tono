import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { windowsPackageComponents } from '../windows-package-components.mjs'

// Layout 7-Zip extracts from a real 0.0.74 NSIS installer (windows-release run
// 36251483271): the installed payload plus the pre-install gate copy of every
// resource under $PLUGINSDIR/tono-gate/.
test('measures the installed payload copy and refuses a gate copy that differs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tono-nsis-'))
  try {
    const put = async (relative, bytes) => {
      await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
      await writeFile(path.join(root, relative), bytes)
    }
    await put('Tono.exe.next', 'app')
    await put('tono-core.exe.next', 'core')
    await put('uninstall.exe', 'uninstaller')
    for (const prefix of ['', '$PLUGINSDIR/tono-gate/']) {
      await put(`${prefix}resources/tono-service.exe`, 'service')
      await put(`${prefix}resources/tono-service-install.exe`, 'install')
      await put(`${prefix}resources/tono-service-uninstall.exe`, 'uninstall')
      await put(`${prefix}resources/core-sha256.txt`, 'digest')
    }

    assert.deepEqual(await windowsPackageComponents(root), {
      app: path.join(root, 'Tono.exe.next'),
      core: path.join(root, 'tono-core.exe.next'),
      privileged: path.join(root, 'resources', 'tono-service.exe'),
    })

    await put('$PLUGINSDIR/tono-gate/resources/tono-service-install.exe', 'other')
    await assert.rejects(windowsPackageComponents(root), /tono-service-install\.exe differs from the installed/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
