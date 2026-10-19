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

  const snapshot = JSON.parse(readFileSync(path.join(root, 'tooling/scripts/sing-box/three-tier-template.json'), 'utf8'))
  if (snapshot.version !== 2 || snapshot.scope !== 'bounded-service-classification-not-IP-geolocation') {
    throw new Error('unrecognized three-tier snapshot contract')
  }
  const countryHosts = [...snapshot.domestic_full, ...snapshot.overseas_full]
  if (!snapshot.domestic_full.length || !snapshot.overseas_full.length || countryHosts.length > 512 ||
      new Set(countryHosts).size !== countryHosts.length || countryHosts.some(host =>
        typeof host !== 'string' || host.length > 253 || !host.includes('.') ||
        host.split('.').some(label => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
        [...home, ...video].some(suffix => host === suffix || host.endsWith(`.${suffix}`)))) {
    throw new Error('invalid, duplicate or protected geographic full host')
  }
  const cidr = /pub const CLAUDE_HOME_IPV4_CIDRS: \[&str; 1\] = \["(160\.79\.104\.0\/21)"\];/.exec(rust)
  if (!cidr) throw new Error('unrecognized protected Home CIDR contract')
  const fixed = {
    $home_suffixes: home, $home_cidrs: [cidr[1]], $video_suffixes: video,
    $domestic_full: snapshot.domestic_full, $overseas_full: snapshot.overseas_full,
  }
  function expand(value) {
    if (typeof value === 'string' && value.startsWith('$')) {
      if (Object.hasOwn(fixed, value)) return fixed[value]
      if (!['$home_target', '$physical_interface', '$fake_ipv4_range'].includes(value)) {
        throw new Error(`unknown routing graph binding: ${value}`)
      }
    }
    if (Array.isArray(value)) return value.map(expand)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v)]))
    return value
  }
  // The AI Home variant shares the bindings; only its graph differs (open
  // DIRECT final, AI-only UDP/ICMP reject, LAN direct, its own tags).
  const aiHome = JSON.parse(readFileSync(path.join(root, 'tooling/scripts/sing-box/ai-home-template.json'), 'utf8'))
  if (aiHome.version !== 1 || aiHome.scope !== 'ai-home-kill-switch-direct-default') {
    throw new Error('unrecognized AI Home snapshot contract')
  }
  const contractTarget = path.join(root, 'apps/macos/Tono/Core/ThreeTierRoutingContract.swift')
  const contractOriginal = readFileSync(contractTarget, 'utf8')
  let contractUpdated = contractOriginal
  for (const [name, graph] of [['templateJSON', snapshot.graph], ['aiHomeTemplateJSON', aiHome.graph]]) {
    const section = new RegExp(`    private static let ${name} = #"""[\\s\\S]*?\\n    """#`, 'g')
    if ([...contractUpdated.matchAll(section)].length !== 1) throw new Error(`expected one Swift graph template ${name}`)
    const graphJSON = JSON.stringify(expand(graph), null, 2)
    if (graphJSON.includes('"""#')) throw new Error('unsafe generated Swift delimiter')
    contractUpdated = contractUpdated.replace(section,
      `    private static let ${name} = #"""\n${graphJSON.split('\n').map(line => `    ${line}`).join('\n')}\n    """#`)
  }
  // Validate and render both targets before either write. CI --check also
  // catches a partially interrupted generation across the two output files.
  if (args[0] === '--write') {
    if (updated !== original) writeFileSync(target, updated)
    if (contractUpdated !== contractOriginal) writeFileSync(contractTarget, contractUpdated)
  } else if (updated !== original || contractUpdated !== contractOriginal) {
    throw new Error('macOS routing domains/graph drifted; run node tooling/scripts/sync-routing-domains.mjs --write')
  }
  console.log(`routing domains: ${model.length} Model API, ${home.length} Home, ${video.length} cloud-video suffixes; ordered macOS/Core/Service parity; three-tier full hosts ${snapshot.domestic_full.length} CN/${snapshot.overseas_full.length} overseas`)
} catch (error) {
  console.error(`routing-domains: ${error.message}`)
  process.exitCode = 1
}
