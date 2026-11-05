import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../../../', import.meta.url)
const rust = readFileSync(new URL('apps/windows/crates/tono-core/src/direct_domains.rs', root), 'utf8')
const array = name => [...rust.match(new RegExp(`pub const ${name}: \\[&str; \\d+\\] = \\[([\\s\\S]*?)\\];`))[1].matchAll(/"([^"]+)"/g)].map(match => match[1])
const lan = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '100.64.0.0/10']
function graph(variant) {
  const snapshot = JSON.parse(readFileSync(new URL(`tooling/scripts/sing-box/${variant}-template.json`, root), 'utf8'))
  const countries = JSON.parse(readFileSync(new URL('tooling/scripts/sing-box/three-tier-template.json', root), 'utf8'))
  const replacements = {
    $home_target: 'HOME', $home_suffixes: array('CLAUDE_HOME_DOMAINS'),
    $home_cidrs: array('CLAUDE_HOME_IPV4_CIDRS'), $video_suffixes: array('CLOUD_VIDEO_DOMAINS'),
    $mobile_home_aux: array('MOBILE_HOME_AUX_SUFFIXES'),
    $cloud_exit_suffixes: [...array('X_CLOUD_SUFFIXES'), ...array('OVERSEAS_CLOUD_SUFFIXES'), ...array('PUBLIC_STUN_SUFFIXES')],
    $cloud_ipv4: array('CLOUD_IPV4_CIDRS'), $cloud_ipv6: array('CLOUD_IPV6_CIDRS'),
    $overseas_udp_reject_ipv4: array('OVERSEAS_UDP_REJECT_IPV4_CIDRS'),
    $overseas_udp_reject_ipv6: array('OVERSEAS_UDP_REJECT_IPV6_CIDRS'),
    $public_stun_suffixes: array('PUBLIC_STUN_SUFFIXES'), $stun_udp_ports: [19302,19303,19304,19305,19306,19307,19308,19309],
    $encrypted_dns_ports: [853], $domestic_full: countries.domestic_full, $overseas_full: countries.overseas_full,
    $lan_ipv4: lan, $lan_ipv6: ['fe80::/10', 'fc00::/7'],
    $lan_protected_suffixes: [...array('CLAUDE_HOME_DOMAINS'), ...array('CLOUD_VIDEO_DOMAINS'), ...array('MOBILE_HOME_AUX_SUFFIXES'), ...array('X_CLOUD_SUFFIXES'), ...array('OVERSEAS_CLOUD_SUFFIXES'), ...array('PUBLIC_STUN_SUFFIXES')],
  }
  return JSON.parse(JSON.stringify(snapshot.graph), (_, value) => typeof value === 'string' && value in replacements ? replacements[value] : value)
}
const list = value => Array.isArray(value) ? value : [value]
const v4 = address => address.split('.').reduce((result, octet) => (result * 256 + Number(octet)) >>> 0, 0)
function inCIDR(address, cidr) {
  if (!address || address.includes(':') || cidr.includes(':')) return false
  const [base, bits] = cidr.split('/')
  const mask = (0xffffffff << (32 - Number(bits))) >>> 0
  return ((v4(address) & mask) >>> 0) === ((v4(base) & mask) >>> 0)
}
function matches(rule, packet) {
  if (rule.type === 'logical') {
    const values = rule.rules.map(child => matches(child, packet))
    const result = rule.mode === 'and' ? values.every(Boolean) : values.some(Boolean)
    return rule.invert ? !result : result
  }
  const result = Object.entries(rule).every(([key, value]) => {
    if (key === 'ip_cidr') return list(value).some(cidr => inCIDR(packet.ip, cidr))
    if (key === 'domain_suffix') return list(value).some(suffix => packet.domain === suffix || packet.domain?.endsWith(`.${suffix}`))
    if (key === 'domain') return list(value).includes(packet.domain)
    if (key === 'ip_version') return value === (packet.ip?.includes(':') ? 6 : 4)
    if (['network', 'port', 'inbound'].includes(key)) return list(value).includes(packet[key])
    return true
  })
  return rule.invert ? !result : result
}
function route(variant, overrides) {
  const packet = { network: 'tcp', port: 443, ...overrides }
  for (const rule of graph(variant).route.rules) {
    if (!matches(rule, packet)) continue
    if (rule.action === 'resolve') { packet.ip ??= packet.answer; continue }
    return rule.outbound ?? rule.action
  }
  throw new Error('no terminating route')
}
test('Three-tier routes the entire LAN set on custom ports, independently of ordinary DIRECT', () => {
  assert.equal(route('three-tier', {ip:'10.2.3.4', port:5000}), 'Tono-ThreeTier-Direct')
  assert.equal(route('three-tier', {ip:'172.20.1.2', port:5000}), 'Tono-ThreeTier-Direct')
  assert.equal(route('three-tier', {ip:'192.168.1.2', port:5000}), 'Tono-ThreeTier-Direct')
  assert.equal(route('three-tier', {ip:'169.254.1.2', port:5000}), 'Tono-ThreeTier-Direct')
  assert.equal(route('three-tier', {ip:'100.64.1.2', port:5000}), 'Tono-ThreeTier-Direct')
})
test('AI Home routes CGNAT peers DIRECT', () => {
  assert.equal(route('ai-home', {ip:'100.64.1.2', port:5000}), 'Tono-AIHome-Direct')
})
test('Three-tier resolves ordinary LAN hostnames before rejecting non-web TCP or UDP', () => {
  assert.equal(route('three-tier', {domain:'nas.example.test', answer:'192.168.1.2', port:5000}), 'Tono-ThreeTier-Direct')
  assert.equal(route('three-tier', {domain:'game.example.test', answer:'100.64.1.2', network:'udp', port:27015}), 'Tono-ThreeTier-Direct')
})
test('a LAN DNS answer cannot divert Home or cloud names to DIRECT', () => {
  assert.equal(route('three-tier', {domain:'claude.ai', ip:'192.168.1.2'}), 'HOME')
  assert.equal(route('three-tier', {domain:'grok.x.com', answer:'100.64.1.2'}), 'HOME')
  assert.equal(route('three-tier', {domain:'www.wikipedia.org', ip:'192.168.1.2'}), 'Tono-Exit')
  assert.equal(route('ai-home', {domain:'claude.ai', ip:'192.168.1.2'}), 'HOME')
})
test('Three-tier refuses LAN DNS while AI Home preserves its existing DNS behaviour', () => {
  const lanDNSReject = rule => rule.action === 'reject'
    && rule.rules?.some(child => child.port?.includes(53) && child.port?.includes(853))
    && JSON.stringify(rule).includes('100.64.0.0/10')
  assert.ok(graph('three-tier').route.rules.some(lanDNSReject))
  assert.ok(!graph('ai-home').route.rules.some(lanDNSReject))
  assert.equal(route('three-tier', {ip:'100.64.1.2', port:53}), 'reject')
  assert.equal(route('three-tier', {ip:'100.64.1.2', network:'udp', port:853}), 'reject')
  assert.equal(route('ai-home', {ip:'100.64.1.2', port:53}), 'hijack-dns')
  assert.equal(route('ai-home', {ip:'100.64.1.2', port:853}), 'Tono-AIHome-Direct')
})
test('ordinary public DIRECT and reserved-address rejection do not widen', () => {
  assert.equal(route('three-tier', {ip:'9.9.9.9', port:5000}), 'reject')
  assert.equal(route('three-tier', {ip:'9.9.9.9', network:'udp'}), 'reject')
  assert.equal(route('three-tier', {ip:'127.0.0.1'}), 'reject')
  assert.equal(route('three-tier', {ip:'0.1.2.3'}), 'reject')
  assert.equal(route('three-tier', {ip:'224.0.0.1'}), 'reject')
})
