#!/usr/bin/env node
// Windows Core and Service already share this std-only Rust source. Generate
// the macOS declarations from it too; never load policy from a user file at runtime.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = path.join(root, 'apps/windows/crates/tono-core/src/direct_domains.rs')
const target = path.join(root, 'apps/macos/Tono/Core/ConfigPipeline.swift')

try {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && !['--check', '--write'].includes(args[0]))) {
    throw new Error('usage: sync-routing-domains.mjs [--check|--write]')
  }
  const rust = readFileSync(source, 'utf8').replace(/\/\/[^\n]*/g, '')
  const declarations = new Map()
  function domains(name) {
    const matches = [...rust.matchAll(new RegExp(`pub const ${name}: \\[&str; (\\d+)\\] = \\[([\\s\\S]*?)\\];`, 'g'))]
    if (matches.length !== 1) throw new Error(`expected one bounded declaration for ${name}`)
    const [, count, body] = matches[0]
    const items = body.trim().replace(/,$/, '').split(',').map(item => item.trim())
    const hosts = items.map(item => {
      const literal = /^"([a-z0-9.-]+)"$/.exec(item)
      if (literal) return literal[1]
      const reference = /^(DEDICATED_MODEL_API_SUFFIXES)\[(\d+)\]$/.exec(item)
      const host = reference && declarations.get(reference[1])?.[Number(reference[2])]
      if (!host) throw new Error(`unsupported domain expression in ${name}: ${item}`)
      return host
    })
    if (hosts.length !== Number(count) || new Set(hosts).size !== hosts.length) {
      throw new Error(`wrong count or duplicate domains in ${name}`)
    }
    for (const host of hosts) {
      const labels = host.split('.')
      if (host.length > 253 || labels.length < 2 || !/[a-z]/.test(labels.at(-1)) ||
          labels.some(label => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
        throw new Error(`invalid suffix in ${name}: ${host}`)
      }
    }
    declarations.set(name, hosts)
    return hosts
  }

  const model = domains('DEDICATED_MODEL_API_SUFFIXES')
  const home = domains('CLAUDE_HOME_DOMAINS')
  const video = domains('CLOUD_VIDEO_DOMAINS')
  if (!model.every((host, index) => home[index] === host)) {
    throw new Error('Home must retain the dedicated Model API prefix in order')
  }
  if (home.some(host => video.includes(host))) throw new Error('Home and video contain the same suffix')

  const original = readFileSync(target, 'utf8')
  let updated = original
  function replace(name, hosts, prefix = '') {
    const declaration = new RegExp(`    static let ${name} = (?:dedicatedModelAPISuffixes \\+ )?\\[[\\s\\S]*?\\n    \\]`, 'g')
    if ([...updated.matchAll(declaration)].length !== 1) throw new Error(`expected one Swift declaration for ${name}`)
    const rendered = `    static let ${name} = ${prefix}[\n${hosts.map(host => `        "${host}",`).join('\n')}\n    ]`
    updated = updated.replace(declaration, rendered)
  }
  replace('dedicatedModelAPISuffixes', model)
  replace('assistantHomeDomainSuffixes', home.slice(model.length), 'dedicatedModelAPISuffixes + ')
  replace('cloudVideoDomainSuffixes', video)
  if (args[0] === '--write') {
    if (updated !== original) writeFileSync(target, updated)
  } else if (updated !== original) {
    throw new Error('macOS routing domains drifted; run node tooling/scripts/sync-routing-domains.mjs --write')
  }
  console.log(`routing domains: ${model.length} Model API, ${home.length} Home, ${video.length} cloud-video suffixes; ordered macOS/Core/Service parity`)
} catch (error) {
  console.error(`routing-domains: ${error.message}`)
  process.exitCode = 1
}
