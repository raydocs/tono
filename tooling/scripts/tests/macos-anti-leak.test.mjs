import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const rust = readFileSync(new URL('../../../apps/windows/crates/tono-core/src/direct_domains.rs', import.meta.url), 'utf8')
  .replace(/\/\/[^\n]*/g, '')
const pipeline = readFileSync(new URL('../../../apps/macos/Tono/Core/ConfigPipeline.swift', import.meta.url), 'utf8')
const product = readFileSync(new URL('../../../apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift', import.meta.url), 'utf8')
const contract = readFileSync(new URL('../../../apps/macos/Tono/Core/ThreeTierRoutingContract.swift', import.meta.url), 'utf8')

function rustArray(name) {
  const match = rust.match(new RegExp(`pub const ${name}: \\[(?:&str|u16); (\\d+)\\] = \\[([\\s\\S]*?)\\];`))
  assert.ok(match, `missing Rust anti-leak declaration ${name}`)
  const values = JSON.parse(`[${match[2].replace(/,\s*$/, '')}]`)
  assert.equal(values.length, Number(match[1]), `count mismatch in ${name}`)
  return values
}

function swiftArray(name) {
  const match = pipeline.match(new RegExp(`static let ${name}: \\[(?:String|Int)\\] = \\[([\\s\\S]*?)\\n    \\]`))
  assert.ok(match, `missing generated Swift declaration ${name}`)
  return JSON.parse(`[${match[1].replace(/,\s*$/, '')}]`)
}

function graph(name) {
  const match = contract.match(new RegExp(`private static let ${name} = #"""([\\s\\S]*?)"""#`))
  assert.ok(match, `missing generated ${name}`)
  return JSON.parse(match[1])
}

function isThreeTierEarlyLanRoute(rule, publicStun) {
  if (rule.action !== 'route' || rule.type !== 'logical' || rule.mode !== 'and' || rule.outbound !== 'Tono-ThreeTier-Direct') {
    return false
  }
  const [cidrPart, invertedPart] = rule.rules ?? []
  const lanSet = [...rustArray('LAN_IPV4_CIDRS'), ...rustArray('LAN_IPV6_CIDRS')]
  const suffixes = invertedPart?.rules?.find(item => Array.isArray(item.domain_suffix))?.domain_suffix ?? []
  return Array.isArray(cidrPart?.ip_cidr)
    && cidrPart.ip_cidr.every(cidr => lanSet.includes(cidr))
    && invertedPart?.invert === true
    && publicStun.every(host => suffixes.includes(host))
}

function assertThreeTierReject(expected, { precedesLan = false } = {}) {
  const publicStun = rustArray('PUBLIC_STUN_SUFFIXES')
  const rules = graph('templateJSON').route.rules
  const dns = rules.findIndex(r => r.action === 'hijack-dns' && Array.isArray(r.port) && r.port.includes(53))
  const match = rules.findIndex(r => JSON.stringify(r) === JSON.stringify(expected))
  const firstPermit = rules.findIndex(r => r.action === 'route' && (precedesLan || !isThreeTierEarlyLanRoute(r, publicStun)))
  assert.ok(dns >= 0, 'templateJSON: missing port-53 hijack-dns')
  assert.ok(match > dns, `templateJSON: missing reject after DNS hijack ${JSON.stringify(expected)}`)
  assert.ok(match < firstPermit, `templateJSON: reject must precede non-LAN route permits ${JSON.stringify(expected)}`)
}

test('generated Swift anti-leak constants match Rust source of truth', () => {
  assert.deepEqual(swiftArray('encryptedDNSPorts'), rustArray('ENCRYPTED_DNS_PORTS'))
  assert.deepEqual(swiftArray('stunUDPPorts'), rustArray('STUN_UDP_PORTS'))
  assert.deepEqual(swiftArray('publicStunSuffixes'), rustArray('PUBLIC_STUN_SUFFIXES'))
  assert.deepEqual(swiftArray('overseasUDPRejectIPv4CIDRs'), rustArray('OVERSEAS_UDP_REJECT_IPV4_CIDRS'))
  assert.deepEqual(swiftArray('overseasUDPRejectIPv6CIDRs'), rustArray('OVERSEAS_UDP_REJECT_IPV6_CIDRS'))
})

test('Stable SingBoxProduct places all five shared anti-leak rejects before routes and keeps local IPv6 before blanket IPv6 reject', () => {
  const dnsHijack = product.indexOf('["port": [53], "action": "hijack-dns"]')
  const firstRoute = product.indexOf('"action": "route"', dnsHijack)
  assert.ok(dnsHijack > 0 && firstRoute > dnsHijack)
  const expectedSnippets = [
    '["port": encryptedDNSPorts, "action": "reject"]',
    '["network": ["udp", "icmp"], "port": stunUDPPorts, "action": "reject"]',
    '["network": ["udp", "icmp"], "domain_suffix": publicStunSuffixes, "action": "reject"]',
    '["network": ["udp", "icmp"], "ip_cidr": overseasUDPRejectIPv4CIDRs, "action": "reject"]',
    '["ip_version": 6, "network": ["udp", "icmp"], "ip_cidr": overseasUDPRejectIPv6CIDRs, "action": "reject"]',
  ]
  let cursor = dnsHijack
  for (const snippet of expectedSnippets) {
    const pos = product.indexOf(snippet)
    assert.ok(pos > cursor && pos < firstRoute, `Stable product missing ordered anti-leak rule: ${snippet}`)
    cursor = pos
  }
  const localBypass = product.indexOf('localNetworkDeviceCIDRs + ["224.0.0.0/4"')
  const blanketIPv6Reject = product.indexOf('["ip_version": 6, "action": "reject"]')
  assert.ok(localBypass > firstRoute && blanketIPv6Reject > localBypass, 'Continuity local IPv6 must precede blanket IPv6 reject')
})

test('DoT and DoQ rejected before every route in Three-tier', () => {
  assertThreeTierReject({ port: rustArray('ENCRYPTED_DNS_PORTS'), action: 'reject' }, { precedesLan: true })
})

test('raw STUN ports rejected before non-LAN DIRECT in Three-tier', () => {
  assertThreeTierReject({ network: ['udp', 'icmp'], port: rustArray('STUN_UDP_PORTS'), action: 'reject' })
})

test('public STUN suffixes rejected before non-LAN DIRECT in Three-tier', () => {
  assertThreeTierReject({ network: ['udp', 'icmp'], domain_suffix: rustArray('PUBLIC_STUN_SUFFIXES'), action: 'reject' })
})

test('overseas IPv4 UDP rejected before non-LAN DIRECT in Three-tier', () => {
  assertThreeTierReject({ network: ['udp', 'icmp'], ip_cidr: rustArray('OVERSEAS_UDP_REJECT_IPV4_CIDRS'), action: 'reject' })
})

test('overseas IPv6 UDP rejected before non-LAN DIRECT without matching local IPv6', () => {
  const cidrs = rustArray('OVERSEAS_UDP_REJECT_IPV6_CIDRS')
  assert.ok(cidrs.every(cidr => !/^(fe80:|fc|fd|ff|::1\/)/i.test(cidr)), 'overseas IPv6 reject must not match local Continuity/LAN IPv6')
  assertThreeTierReject({ ip_version: 6, network: ['udp', 'icmp'], ip_cidr: cidrs, action: 'reject' })
})

test('AI Home keeps ordinary UDP open per Decision 130 while pairing every Home TCP route with UDP/ICMP reject', () => {
  const rules = graph('aiHomeTemplateJSON').route.rules
  assert.equal(rules.some(r => JSON.stringify(r) === JSON.stringify({ port: rustArray('ENCRYPTED_DNS_PORTS'), action: 'reject' })), false)
  assert.equal(rules.some(r => JSON.stringify(r) === JSON.stringify({ network: ['udp', 'icmp'], port: rustArray('STUN_UDP_PORTS'), action: 'reject' })), false)
  assert.equal(rules.some(r => Array.isArray(r.network) && r.network.includes('udp') && !r.domain_suffix && !r.ip_cidr && !r.domain), false)
  const homeIndices = rules.flatMap((r, i) => (r.outbound === '$home_target' ? [i] : []))
  assert.equal(homeIndices.length, 5)
  for (const index of homeIndices) {
    assert.equal(rules[index].network, 'tcp')
    assert.deepEqual(rules[index + 1].network, ['udp', 'icmp'])
    assert.equal(rules[index + 1].action, 'reject')
  }
})

test('HTTPS and SVCB suppressed on client listeners before real DNS resolvers', () => {
  assert.ok(
    product.includes('dnsRules.append(["inbound": ["Tono-DNS", "Tono-TUN", "Tono-Mixed"], "query_type": ["HTTPS", "SVCB"],\n            "action": "predefined", "rcode": "NOERROR"])'),
    'Stable product missing client-listener HTTPS/SVCB suppression'
  )
  for (const name of ['templateJSON', 'aiHomeTemplateJSON']) {
    const dnsRules = graph(name).dns.rules
    const firstUpstream = dnsRules.findIndex(r => typeof r.server === 'string' && r.server !== 'Tono-FakeIP')
    const suppressed = dnsRules.filter(r =>
      JSON.stringify(r.query_type) === JSON.stringify(['HTTPS', 'SVCB']) && r.action === 'predefined' && r.rcode === 'NOERROR'
    )
    assert.ok(suppressed.length >= 5, `${name}: missing protected HTTPS/SVCB suppression rules`)
    for (const rule of suppressed) {
      assert.ok(dnsRules.indexOf(rule) < firstUpstream, `${name}: HTTPS/SVCB suppression must precede real resolvers`)
    }
  }
})
