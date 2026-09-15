import assert from 'node:assert/strict'

import { test } from 'vitest'

import { memberDetails, providerNameOf } from '@/types/proxy-view'

const node = {
  recordId: 'p:0:0',
  name: 'provider-node',
  type: 'Shadowsocks',
  alive: true,
  history: [],
  udp: true,
  xudp: false,
  tfo: false,
  mptcp: false,
  smux: false,
  source: {
    kind: 'provider',
    providerName: 'provider-key',
    proxyName: 'provider-node',
  },
}

test('memberDetails returns the backing node for a resolved node member', () => {
  const resolved = {
    kind: 'node',
    ref: { kind: 'node', name: node.name, recordId: node.recordId },
    node,
  }
  assert.equal(memberDetails(resolved), node)
  assert.equal(providerNameOf(node), 'provider-key')
})

test('memberDetails returns undefined for an unresolved member', () => {
  const resolved = {
    kind: 'unresolved',
    ref: {
      kind: 'unresolved',
      name: 'unknown',
      reason: 'provider-unavailable',
    },
  }
  assert.equal(memberDetails(resolved), undefined)
})
