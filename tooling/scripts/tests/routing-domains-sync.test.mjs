import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

test('the CLI preserves ordered policy, detects drift and refuses ambiguous source without writing', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tono-routing-sync-'))
  try {
    const antiLeakSource = readFileSync(new URL('../../../apps/windows/crates/tono-core/src/direct_domains.rs', import.meta.url), 'utf8')
    const antiLeakDeclarations = ['ENCRYPTED_DNS_PORTS', 'STUN_UDP_PORTS', 'PUBLIC_STUN_SUFFIXES', 'OVERSEAS_UDP_REJECT_IPV4_CIDRS', 'OVERSEAS_UDP_REJECT_IPV6_CIDRS'].map(name =>
      antiLeakSource.match(new RegExp(`pub const ${name}: \\[(?:&str|u16); \\d+\\] = \\[([\\s\\S]*?)\\];`))[0]).join('\n')
    const transport = { route: { rules: [{ port: 53, action: 'hijack-dns' }] }, dns: { rules: [] } }
    for (const dir of ['tooling/scripts/sing-box', 'apps/windows/crates/tono-core/src', 'apps/macos/Tono/Core']) {
      mkdirSync(path.join(root, dir), { recursive: true })
    }
    const script = path.join(root, 'tooling/scripts/sync-routing-domains.mjs')
    copyFileSync(fileURLToPath(new URL('../sync-routing-domains.mjs', import.meta.url)), script)
    const snapshot = path.join(root, 'tooling/scripts/sing-box/three-tier-template.json')
    writeFileSync(snapshot, JSON.stringify({ version: 2, scope: 'bounded-service-classification-not-IP-geolocation',
      domestic_full: ['www.local.test'], overseas_full: ['www.foreign.test'],
      graph: { ...transport, rules: ['$home_suffixes', '$video_suffixes', '$domestic_full', '$overseas_full', '$home_cidrs', '$home_target'] } }))
    writeFileSync(path.join(root, 'tooling/scripts/sing-box/ai-home-template.json'), JSON.stringify({ version: 1,
      scope: 'ai-home-kill-switch-direct-default', graph: { ...transport, rules: ['$home_suffixes', '$overseas_full', '$home_target'] } }))
    const contract = path.join(root, 'apps/macos/Tono/Core/ThreeTierRoutingContract.swift')
    writeFileSync(contract, '    private static let templateJSON = #"""\n    {}\n    """#\n'
      + '    private static let aiHomeTemplateJSON = #"""\n    {}\n    """#\n'
      + '    private static let antiLeakRouteJSON = #"""\n    []\n    """#\n')
    const source = path.join(root, 'apps/windows/crates/tono-core/src/direct_domains.rs')
    const target = path.join(root, 'apps/macos/Tono/Core/ConfigPipeline.swift')
    const rust = `pub const DEDICATED_MODEL_API_SUFFIXES: [&str; 1] = ["ai.vendor.cn"];
pub const CLAUDE_HOME_DOMAINS: [&str; 3] = [DEDICATED_MODEL_API_SUFFIXES[0], "z.example.com", "a.example.com"];
pub const CLOUD_VIDEO_DOMAINS: [&str; 1] = ["video.z.example.com"];
pub const CLAUDE_HOME_IPV4_CIDRS: [&str; 1] = ["160.79.104.0/21"];\n${antiLeakDeclarations}`
    writeFileSync(source, rust)
    writeFileSync(target, `// before: untouched
    static let dedicatedModelAPISuffixes = [
        "stale.test",
    ]
    static let assistantHomeDomainSuffixes = dedicatedModelAPISuffixes + [
        "stale.test",
    ]
    static let cloudVideoDomainSuffixes = [
        "stale.test",
    ]
// after: untouched
`)
    const run = flag => spawnSync(process.execPath, [script, flag], { encoding: 'utf8' })
    assert.equal(run('--check').status, 1)
    const write = run('--write')
    assert.equal(write.status, 0, write.stderr)
    const expected = `// before: untouched
    static let dedicatedModelAPISuffixes = [
        "ai.vendor.cn",
    ]
    static let assistantHomeDomainSuffixes = dedicatedModelAPISuffixes + [
        "z.example.com",
        "a.example.com",
    ]
    static let cloudVideoDomainSuffixes = [
        "video.z.example.com",
    ]
// after: untouched
`
    assert.equal(readFileSync(target, 'utf8'), expected)
    assert.equal(run('--check').status, 0)
    const generated = readFileSync(contract, 'utf8')
    const [graph, aiHomeGraph] = [...generated.matchAll(/#"""\n([\s\S]*?)\n    """#/g)].map(match => JSON.parse(match[1]))
    assert.deepEqual(graph.rules, [['ai.vendor.cn', 'z.example.com', 'a.example.com'],
      ['video.z.example.com'], ['www.local.test'], ['www.foreign.test'], ['160.79.104.0/21'], '$home_target'])
    assert.deepEqual(aiHomeGraph.rules, [['ai.vendor.cn', 'z.example.com', 'a.example.com'], ['www.foreign.test'], '$home_target'],
      'AI Home shares the same Home and overseas bindings')
    // The more-specific cloud video child is legitimate, not a reason to sort
    // or deduplicate away its wider Home parent. An exact duplicate is not.
    writeFileSync(source, rust.replace('"a.example.com"', '"z.example.com"'))
    assert.equal(run('--write').status, 1)
    assert.equal(readFileSync(target, 'utf8'), expected)
    writeFileSync(source, rust.replace('DEDICATED_MODEL_API_SUFFIXES[0]', 'DEDICATED_MODEL_API_SUFFIXES[9]'))
    assert.equal(run('--write').status, 1)
    assert.equal(readFileSync(target, 'utf8'), expected)
    assert.equal(readFileSync(contract, 'utf8'), generated)
    writeFileSync(source, rust)
    const corrupt = JSON.parse(readFileSync(snapshot, 'utf8'))
    corrupt.domestic_full.push('api.ai.vendor.cn')
    writeFileSync(snapshot, JSON.stringify(corrupt))
    assert.equal(run('--write').status, 1, 'a geographic host must not override a protected Home parent')
    assert.equal(readFileSync(target, 'utf8'), expected)
    assert.equal(readFileSync(contract, 'utf8'), generated)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
