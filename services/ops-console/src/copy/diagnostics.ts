import { customerCopy } from './customers';

// 失败聚类和单个客户的自动诊断（pages/diagnostics）。
export const diagnosticsCopy = {
  diagnosticsPanel: {
    clustersTitle: '失败聚类',
    clustersNone: '这段时间没有打开的失败聚类。',
    clustersLoading: '正在读取失败聚类…',
    clustersUnavailable: '失败聚类还读不到。',
    clusterReach: (users: number, devices: number) => `${users} 人 / ${devices} 台`,
    clusterNoNode: '没选节点',
    sessionsTitle: '自动诊断',
    sessionsLoading: '正在读取自动诊断…',
    sessionsUnavailable: '这份自动诊断还读不到。控制面接口部署之后，这里会显示会话、链路和 DNS。',
    sessionsNone: '还没有自动诊断会话。',
    sessionNoNode: '未选节点',
    sessionRunning: '进行中',
    sessionDown: (bytes: number) => ` · 下行 ${bytes}`,
    sessionUp: (bytes: number) => ` · 上行 ${bytes}`,
    dnsLeft: '有一次 DNS 检查没有留在隧道里。',
    hopDown: '有一跳没有连上。',
  },
} as const;

/**
 * Cluster codes the clients report beyond the dial codes in `customerCopy.codeWord`.
 * One sentence each, said the way the operator would say it to a customer.
 */
const CLUSTER_CODE_WORD: Record<string, string> = {
  TONO_NETWORK_LOSS: '保护期间客户断网了',
  TONO_FAIL_OPEN: '保护失效，流量被放开了',
  TONO_WATCHDOG_RESTORE: '自动恢复了客户的网络',
  TONO_KILL_SWITCH_STUCK: '断网保护卡住，客户上不了网',
  TONO_RESTORE_NETWORK: '客户手动恢复了网络',
  TONO_CRASH_WHILE_PROTECTED: '保护中应用崩溃了',
  TONO_CONNECT_DNS: '连接时域名解析失败',
  TONO_CONNECT_TCP: '连接时 TCP 不通',
  TONO_CONNECT_TLS: '连接时加密握手失败',
  TONO_CONNECT_QUIC: '连接时 QUIC 不通',
  TONO_CONNECT_TIMEOUT: '连接超时',
  TONO_CONNECT_TUN: '隧道没建起来',
  TONO_CONNECT_CAPTIVE: '网络要先网页登录才能用',
  TONO_CONNECT_LOCAL_CONFLICT: '本机有冲突的网络软件',
  TONO_CONNECT_HY2_IDLE: '备用通道空闲掉线',
  TONO_CONNECT_RELEASED: '连接被主动释放了',
  TONO_AUTH_DNS: '登录时域名解析失败',
  TONO_AUTH_TCP: '登录时 TCP 不通',
  TONO_AUTH_TLS: '登录时加密握手失败',
  TONO_AUTH_QUIC: '登录时 QUIC 不通',
  TONO_AUTH_TIMEOUT: '登录超时',
  TONO_AUTH_API: '登录接口出错',
  TONO_AUTH_UNREACHABLE: '登录服务连不上',
  TONO_AUTH_CAPTIVE: '登录时网络要先网页登录',
  TONO_AUTH_LOCAL_CONFLICT: '登录时本机有冲突的网络软件',
  TONO_AUTH_RATE_LIMITED: '登录被限流了',
  TONO_AUTH_UNAUTHORIZED: '登录没通过',
  TONO_AUTH_FORBIDDEN: '登录被拒绝了',
  TONO_AUTH_INVALID_CODE: '验证码不对',
  TONO_AUTH_DEVICE_LIMIT: '设备数到上限了',
  TONO_AUTH_STORE: '本机凭据读写失败',
  TONO_TLS_TIMEOUT: '加密握手超时',
  TONO_TLS_INTERCEPTED: '加密连接被中间设备拦截',
  TONO_CLOCK_SKEW: '客户电脑的时间不准',
  TONO_CAPTIVE_PORTAL: '网络要先网页登录才能用',
  TONO_OTHER_VPN_PRESENT: '本机还有别的 VPN',
  TONO_TUN_ROUTE_UNAVAILABLE: '流量没能进入隧道',
  TONO_TUN_INGRESS_BROKEN: '隧道入口坏了',
  TONO_TUN_DATA_PLANE_BROKEN: '隧道里不通了',
};

/** Where in the attempt it failed: connect steps, the auto-heal ladder, the P0 report. */
const CLUSTER_STAGE_WORD: Record<string, string> = {
  preparing: '准备保护',
  preparingHelper: '准备助手',
  preparingService: '准备服务',
  startingKillSwitch: '断网保护',
  startingTunnel: '建立隧道',
  lockingTraffic: '锁定流量',
  applyingCloudPolicy: '应用路由',
  securingDNS: '保护 DNS',
  checkingExit: '验证出口',
  verifyingTraffic: '验证流量',
  catalogInstall: '装节点单',
  health: '健康检查',
  nativeUpdateRecovery: '更新恢复',
  protection: '掉线保护',
  connect: '连接中',
  connected: '已连接',
  handshake: '握手',
  auth: '身份认证',
  dns: '域名解析',
  'config-cache': '读缓存',
  'tcp-or-quic-preflight': '预连探测',
  'tun-setup': '建立隧道',
  'route-install': '装路由',
  'hy2-quic-tls': '备用握手',
  'first-byte': '首包',
};

/** The server closes a cluster by letting it go quiet; there is no third state. */
const CLUSTER_STATUS_WORD: Record<string, string> = {
  open: '进行中',
  quiet: '已安静',
};

function lookup(table: Record<string, string>, key: string): string {
  return Object.hasOwn(table, key) ? (table[key] ?? key) : key;
}

/** The Chinese sentence for a cluster code; a code nobody has written a line for stays raw. */
export function clusterCode(code: string): string {
  return lookup({ ...customerCopy.codeWord, ...CLUSTER_CODE_WORD }, code);
}

export function clusterStage(stage: string): string {
  return lookup(CLUSTER_STAGE_WORD, stage);
}

export function clusterStatus(status: string): string {
  return lookup(CLUSTER_STATUS_WORD, status);
}

/** The client sends `unselected` when no node was chosen; an empty name is the same case. */
export function clusterNode(node: string | null): string {
  if (node === null || node === '' || node === 'unselected') return diagnosticsCopy.diagnosticsPanel.clusterNoNode;
  return node;
}
