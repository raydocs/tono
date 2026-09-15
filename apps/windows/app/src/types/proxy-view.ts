interface ProxyCapabilities {
  udp: boolean
  xudp: boolean
  tfo: boolean
  mptcp: boolean
  smux: boolean
}

interface DelayHistory {
  time: string
  delay: number
}

export interface ProxyGroupView extends ProxyCapabilities {
  name: string
  type: string
  alive: boolean
  now?: string
  fixed?: string
  hidden?: boolean
  icon?: string
  testUrl?: string
  history: DelayHistory[]
  members: ProxyMemberRef[]
}

export interface ProxyNodeView extends ProxyCapabilities {
  recordId: string
  name: string
  type: string
  alive: boolean
  history: DelayHistory[]
  id?: string
  hidden?: boolean
  icon?: string
  testUrl?: string
  source:
    | { kind: 'core'; proxyName: string }
    | { kind: 'provider'; providerName: string; proxyName: string }
}

type ProxyMemberUnresolvedReason =
  | 'missing'
  | 'ambiguous'
  | 'provider-unavailable'

export type ProxyMemberRef =
  | { kind: 'group'; name: string }
  | { kind: 'node'; name: string; recordId: string }
  | {
      kind: 'unresolved'
      name: string
      reason: ProxyMemberUnresolvedReason
    }

export type ResolvedProxyMember =
  | {
      kind: 'group'
      ref: Extract<ProxyMemberRef, { kind: 'group' }>
      group: ProxyGroupView
    }
  | {
      kind: 'node'
      ref: Extract<ProxyMemberRef, { kind: 'node' }>
      node: ProxyNodeView
    }
  | {
      kind: 'unresolved'
      ref: Extract<ProxyMemberRef, { kind: 'unresolved' }>
    }

export type InteractableProxyMember = Exclude<
  ResolvedProxyMember,
  { kind: 'unresolved' }
>

export const memberDetails = (member: ResolvedProxyMember) =>
  member.kind === 'node'
    ? member.node
    : member.kind === 'group'
      ? member.group
      : undefined

export const providerNameOf = (node: ProxyNodeView) =>
  node.source.kind === 'provider' ? node.source.providerName : undefined
