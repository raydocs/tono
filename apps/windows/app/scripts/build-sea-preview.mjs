import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import AdmZip from 'adm-zip'
import { build } from 'vite'

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(app)
await build({ configFile: path.join(app, 'vite.scene-preview.config.mts') })
const output = path.join(app, 'sea-preview')
const html = (await readFile('src/dev/sea-scene/index.html', 'utf8')).replace(
  '<script type="module" src="./main.tsx"></script>',
  '<link rel="stylesheet" href="./scene.css" /><script src="./scene.js"></script>',
)
await writeFile(path.join(output, 'index.html'), html)
await writeFile(
  path.join(output, 'README.txt'),
  await readFile('src/dev/sea-scene/WINDOWS-PREVIEW.txt'),
)
const files = [
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'src/tono-ui/SeaScene.tsx',
  'src/tono-ui/sea-scene.css',
  'src/tono-ui/appearance-preferences.ts',
  'src/tono-ui/scene-quality-probe.ts',
  'src/tono-ui/useSceneQuality.ts',
  'src/tono-ui/tokens/motion.css',
  'src/dev/sea-scene/main.tsx',
  'src/dev/sea-scene/preview.css',
  'src/dev/sea-scene/index.html',
  'src/dev/sea-scene/WINDOWS-PREVIEW.txt',
  'src/locales/en/tono.json',
  'src/locales/zh/tono.json',
  'vite.scene-preview.config.mts',
  'scripts/build-sea-preview.mjs',
  ...(await readdir('src/tono-ui/sea-assets'))
    .sort()
    .map((file) => `src/tono-ui/sea-assets/${file}`),
]
const sources = {}
for (const file of files)
  sources[file] = createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
await writeFile(
  path.join(output, 'sources.json'),
  `${JSON.stringify(
    {
      description:
        'Exact build-input SHA-256 fingerprints; compare with the PR checkout, not an inferred commit.',
      sources,
    },
    null,
    2,
  )}\n`,
)
const archive = new AdmZip()
archive.addLocalFolder(output, 'tono-sea-preview')
archive.writeZip(path.join(app, 'sea-preview.zip'))
const hash = createHash('sha256')
  .update(await readFile('sea-preview.zip'))
  .digest('hex')
console.log(`Standalone preview: ${output}; sea-preview.zip SHA256 ${hash}`)
