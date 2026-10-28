import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const contract = readFileSync(new URL('../../../apps/macos/Tono/Core/ThreeTierRoutingContract.swift', import.meta.url), 'utf8')
const rust = readFileSync(new URL('../../../apps/windows/crates/tono-core/src/direct_domains.rs', import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, '')
function array(name) {
  const body = rust.match(new RegExp(`pub const ${name}: \\[(?:&str|u16); \\d+\\] = \\[([\\s\\S]*?)\\];`))[1]
  return JSON.parse(`[${body.replace(/,\s*$/, '')}]`)
}
function graph(name) {
  const match = contract.match(new RegExp(`private static let ${name} = #"""([\\s\\S]*?)"""#`))
  assert.ok(match, `missing generated ${name}`)
  return JSON.parse(match[1])
}
function rejects(expected) {
  for (const name of ['templateJSON', 'aiHomeTemplateJSON']) {
    const rules = graph(name).route.rules
    const dns = rules.findIndex(r => r.action === 'hijack-dns' && (r.port === 53 || r.port?.includes(53)))
    const match = rules.findIndex(r => JSON.stringify(r) === JSON.stringify(expected))
    assert.ok(match > dns, `${name}: missing reject after DNS hijack ${JSON.stringify(expected)}`)
    assert.ok(match < rules.findIndex(r => r.action === 'route'), `${name}: reject must precede routing`)
  }
  assert.ok(graph('antiLeakRouteJSON').some(r => JSON.stringify(r) === JSON.stringify(expected)), 'selective contract missing rule')
}
test('DoT and DoQ rejected before DIRECT', () => rejects({port: array('ENCRYPTED_DNS_PORTS'), action: 'reject'}))
test('raw STUN ports rejected before DIRECT', () => rejects({network: ['udp', 'icmp'], port: array('STUN_UDP_PORTS'), action: 'reject'}))
test('public STUN suffixes rejected before DIRECT', () => rejects({network: ['udp', 'icmp'], domain_suffix: array('PUBLIC_STUN_SUFFIXES'), action: 'reject'}))
test('overseas IPv4 UDP rejected before DIRECT', () => rejects({network: ['udp', 'icmp'], ip_cidr: array('OVERSEAS_UDP_REJECT_IPV4_CIDRS'), action: 'reject'}))
test('overseas IPv6 UDP rejected before DIRECT', () => rejects({ip_version: 6, network: ['udp', 'icmp'], ip_cidr: array('OVERSEAS_UDP_REJECT_IPV6_CIDRS'), action: 'reject'}))
test('HTTPS and SVCB suppressed before DNS routing', () => {
  for (const name of ['templateJSON', 'aiHomeTemplateJSON']) {
    assert.deepEqual(graph(name).dns.rules[0], {query_type: [65, 64], action: 'predefined', rcode: 'NOERROR'})
  }
})
