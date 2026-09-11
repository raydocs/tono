// 客户 and 客户 360.
import { customerActionCopy } from './customers-actions';
import { followupCopy } from './followups';

export const customerCopy = {
  // 读出来的名词在这一份，按下去的动作在另一份：一页的词表长到要翻页就分家。
  ...customerActionCopy,
  // 跟进和回复草稿自成一份：今天页的处置卡读的是同一批词。
  ...followupCopy,
  customerHealth: {
    unreachable: '连不上',
    unstable: '不稳',
    // 开通了、从来没连上过。不是故障，所以从来不上事故色。
    never_used: '还没用起来',
    unreported: '未上报',
    offline: '离线',
    ok: '正常',
  } as const,
  lifecycle: {
    active: '在用',
    suspended: '已停用',
    expired: '已到期',
  } as const,
  /**
   * Each fragment is the health word its rows carry, so clicking one gives a
   * table where every row repeats the word that was just counted.
   */
  customerCount: {
    all: (n: number) => `${n} 位客户`,
    ok: (n: number) => `${n} 位正常`,
    unreachable: (n: number) => `${n} 位连不上`,
    never_used: (n: number) => `${n} 位还没用起来`,
  },
  customerPlanNotWired: '服务使用、最低版本和到期还没有一位客户填过，先不占位置',
  platform: {
    macos: 'macOS',
    windows: 'Windows',
    linux: 'Linux',
    android: 'Android',
    ios: 'iOS',
  } as const,
  unreleased: '未发布',
  /* ------------------------------------------------------------ 开通漏斗 */

  /**
   * 开通到用起来之间的五步，每一段的名字就是站在这一步的人还差什么。
   *
   * 最后一段"连上过"是好的那一头：点进去是已经用起来的人，前面四段才是这一页
   * 每天早上要看的。
   */
  funnelCount: {
    invited: (n: number) => `${n} 位开通了还没注册`,
    registered: (n: number) => `${n} 位注册了还没装客户端`,
    device_added: (n: number) => `${n} 位装了还没上报`,
    reported: (n: number) => `${n} 位上报过还没连上`,
    connected: (n: number) => `${n} 位连上过`,
  },
  /** 卡了多久的一句话。上报过的那一步没有天数：卡在哪一天说不清楚。 */
  funnelLine: {
    invited: (days: number) => `开通 ${days} 天还没注册`,
    registered: (days: number) => `注册 ${days} 天还没装客户端`,
    device_added: (days: number) => `装了 ${days} 天还没上报`,
    reported: () => '上报过，还没连上过',
    connected: () => '连上过',
  },
  /** 名单上的人还没有账号，所以只有一个中性的标，没有健康词。 */
  inviteTag: '未注册',
  inviteDrawerTitle: '还没注册的这一位',
  inviteLead: '这个邮箱能登录了，但客户还没在客户端登录过，所以没有账号可看。',
  inviteFields: {
    wechatId: '微信号',
    contact: '联系方式',
    notes: '备注',
    invitedAt: '开通时间',
  } as const,
  inviteSave: '保存',
  inviteRevoke: '撤销开通',
  inviteRevokeTitle: '撤销这次开通',
  inviteRevokeBody: (email: string) => `${email} 会从允许登录的名单里去掉，之后再注册会被挡回去。`,
  /** 待办上的一行：先说是谁，再说卡在哪一步。 */
  onboardChore: (who: string, line: string) => `${who} ${line}`,
  /** 名单上的人只有一个微信号可以找，所以复制按钮把整串真号放进剪贴板。 */
  copyWechat: '复制微信号',
  copiedWechat: '已复制',
  firstConnectedAt: (ago: string, day: string) => `${ago} · ${day}`,
  customerColumns: {
    status: '状态',
    customer: '客户',
    wechat: '微信',
    devices: '设备',
    node: '当前节点',
    failure: '最近失败',
    usage: '本期流量',
    services: '服务使用',
    minVersion: '最低版本',
    expires: '到期',
    followup: '跟进',
  } as const,
  deviceUnit: '台',
  overQuota: '超额',
  usageTitle: (used: string, quota: string, remain: string) => `已用 ${used} / 额度 ${quota} · 剩余 ${remain}`,
  usageNoQuota: (used: string) => `已用 ${used} · 未设额度`,
  emptyCustomers: '没有客户',

  customerSections: {
    now: '现在',
    timeline: '连接时间线',
    activity: '使用时段',
    destinations: '流量去向',
    services: '服务使用',
    carriers: '按运营商的路径',
    devices: '设备',
    diagnostics: '诊断报告',
    chores: '待办',
    billing: '账务与用量',
  } as const,
  now: {
    stage: '开通进度',
    connected: '在连',
    node: '节点',
    since: '连了多久',
    device: '设备',
    version: '版本与系统',
    carrier: '运营商与省份',
    yes: '在连',
    no: '没连',
  } as const,
  quota: '额度',
  expiresAt: '到期',

  timelineFilters: {
    all: '全部',
    failed: '只看失败',
    device: '设备',
    week: '最近 7 天',
  } as const,
  timelineColumns: {
    at: '时间',
    outcome: '结果',
    node: '节点',
    who: '客户',
    stage: '阶段',
    code: '代码',
    elapsed: '耗时',
    client: '平台与版本',
    carrier: '运营商',
  } as const,
  /** Channel on a connection row. hy2 is the same-node backup, never the English type name. */
  transportWord: {
    tcp: '主通道',
    hy2: '备用通道',
  } as const,
  daySummary: (ok: number, fail: number, switched: number) => `${ok} 次连上 · ${fail} 次失败 · ${switched} 次换节点`,
  /** The upload went through the tunnel, so the carrier on it is the exit's. */
  carrierViaExit: '这条上报走的是隧道，看到的是出口的运营商',
  emptyTimeline: '这位客户还没有上报过连接',
  noCarrierPaths: '还没有够判断的连接记录',
  eventWord: {
    connectBegin: '开始连接',
    connectOk: '连上',
    connectFail: '没连上',
    nodeSwitch: '换节点',
    connectCatalogFailover: '换线路',
    healthProbeFail: '探测没过',
    protectedOffline: '掉线保护',
    coreRestart: '内核重启',
    reconnectScheduled: '准备重连',
    networkChange: '网络变了',
    disconnectOk: '断开',
    releaseFail: '发布失败',
    syncFail: '同步失败',
  } as const,
  stageWord: {
    dial: '拨号',
    handshake: '握手',
    tls: '加密',
    catalog: '取节点',
    probe: '探测',
    checkingexit: '验证出口',
    verifyingtraffic: '验证流量',
    securingdns: '保护 DNS',
    startingtunnel: '建立隧道',
    lockingtraffic: '锁定流量',
  } as const,
  codeWord: {
    ECONNREFUSED: '对方端口没人应答',
    ETIMEDOUT: '连接超时，没等到回应',
    EHOSTUNREACH: '到不了这台机器',
    TLS_HANDSHAKE_TIMEOUT: '加密握手超时',
    REALITY_AUTH_FAIL: '身份校验没通过',
    CATALOG_STALE: '客户端手里的节点单子太旧',
    DNS_FAIL: '域名解析失败',
    CORE_EXIT_UNREACHABLE: '当前节点和核心都没通过验证',
    TONO_NODE_OR_CORE_UNREACHABLE: '当前节点和核心都没通过验证',
    UNKNOWN_CLASSIFIED_FAILURE: '受保护连接失败，已记下诊断',
    TUN_ROUTE_UNAVAILABLE: '流量没能进入隧道',
    PROTECTED_DNS_NOT_READY: '系统 DNS 还没进入保护路径',
    NETWORK_ENVIRONMENT_OFFLINE: '当前网络不可用',
    UNKNOWN: '客户端没说原因',
  } as const,

  activityLegend: '每格一小时，深色是已连接',
  activityHour: (hour: string, minutes: number) => `${hour} 已连接 ${minutes} 分钟`,
  weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const,

  destinationColumns: {
    site: '目的地',
    route: '路由',
    node: '节点',
    connections: '连接数',
    bytes: '流量',
    action: '',
  } as const,
  route: {
    cloud: '云出口',
    residential: '家宽',
    direct: '直连',
    reject: '拒绝',
    unknown: '未知',
  } as const,
  markDirect: '标为直连候选',
  markDirectBlocked: '接口未接入',

  serviceColumns: {
    family: '服务',
    route: '走哪条路',
    bytes: '7 天流量',
    lastSeen: '最近使用',
  } as const,
  serviceName: {
    claude: 'Claude',
    chatgpt: 'ChatGPT',
    grok: 'Grok',
    gemini: 'Gemini',
    meta: 'Meta',
    other: '其他',
  } as const,

  carrierMatrix: {
    carrier: '运营商',
    okRate: '成功率',
    latency: '中位耗时',
    samples: '次数',
  } as const,
  deviceColumns: {
    name: '设备',
    platform: '平台',
    version: '版本',
    os: '系统',
    lastSeen: '最近在线',
    node: '当前节点',
    action: '动作',
  } as const,
  deviceActionBlocked: (platform: string) => `${platform} 客户端还没有这个动作`,
  foldOpen: '展开',
  foldShut: '收起',
  noDiagnostics: '还没有回传的诊断报告',
  noChores: '没有待办',
  billingFacts: {
    plan: '套餐',
    deviceLimit: '设备上限',
    usage: '本期用量',
    quota: '额度',
    expires: '到期',
    since: '首次开通',
    firstConnected: '第一次连上',
  } as const,
} as const;
