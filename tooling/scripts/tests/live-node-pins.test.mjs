import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

test('the four live exits keep the measured Reality SNI and TCP profile', () => {
  const pins = JSON.parse(readFileSync(path.join(root, 'config/fleet/live-node-pins.json'), 'utf8'))
  const fronts = JSON.parse(readFileSync(path.join(root, 'tooling/scripts/reality-fronts.json'), 'utf8'))
  const tune = readFileSync(path.join(root, 'tooling/scripts/remote/tune-tono-tcp.sh'), 'utf8')
  const audit = readFileSync(path.join(root, 'tooling/scripts/check-node-in-fleet.py'), 'utf8')
  const desired = /DESIRED="([^"]+)"/.exec(tune)
  assert.ok(desired, 'tune-tono-tcp.sh DESIRED block')
  const fromScript = Object.fromEntries(desired[1].trim().split('\n').map((line) => {
    const split = line.indexOf(' = ')
    assert.ok(split > 0, line)
    return [line.slice(0, split), line.slice(split + 3)]
  }))
  assert.deepEqual(pins.kernel.sysctl, fromScript)
  const profile = [...audit.matchAll(/\("([^"]+)", "([^"]+)"\)/g)]
    .filter(([_, key]) => key.startsWith('net.'))
  assert.ok(profile.length >= 7)
  for (const [, key, value] of profile) {
    assert.equal(pins.kernel.sysctl[key], value, key)
  }
  assert.deepEqual(pins.reality.nodes.map((node) => node.name), [
    'Tokyo · Sakura', 'Tokyo · Fuji', 'JP-VLESS-Reality', 'Buffalo · Erie',
  ])
  assert.equal(JSON.stringify(pins).includes('38.14.195.144'), false)
  for (const node of pins.reality.nodes) {
    assert.equal(fronts.nodeTargets[node.name], node.target)
    assert.equal(fronts.nodeTargets[node.ipv4], node.target)
    assert.deepEqual(node.serverNames, [node.target])
    assert.equal(fronts.usable.includes(node.target), true)
  }
})
