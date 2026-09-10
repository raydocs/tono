// 今天: incidents, chores, and the two lists behind them.
export const todayCopy = {
  todayVerdict: (incidents: number, customers: number) => `现在 ${incidents} 个事故，影响 ${customers} 位客户`,
  todayClear: (when: string) => `现在没有事故。上次事故 ${when} 已恢复。`,
  todayNeverAny: '现在没有事故。',
  todayTabs: {
    open: '进行中',
    resolved: '最近恢复',
    chores: '待办',
  } as const,
  tabCount: (n: number) => `${n}`,
  severity: {
    severe: '严重',
    warn: '注意',
    notice: '提示',
  } as const,
  incidentImpact: (n: number) => `影响 ${n} 位客户`,
  incidentImpactNode: (n: number) => `影响 ${n} 台节点`,
  incidentOpenFor: '已持续',
  incidentLastSeen: '最后测量',
  incidentResolvedAt: '已恢复',
  incidentPrimary: {
    ack: '认领',
    snooze: '静默 4 小时',
    resolve: '标记已处理',
    note: '备注',
  } as const,
  /**
   * The one thing worth doing about this kind of incident.
   *
   * 认领 is not that thing — it says someone is looking, and the fleet is
   * exactly as broken afterwards — so it moves aside for whatever actually
   * moves the fault, and the row leads with the action that does.
   */
  incidentAction: {
    retirePreview: '下架预览',
    openCustomer: '打开客户',
    sources: '查看数据源',
  } as const,
  incidentActionBlocked: {
    noNode: '这条事故没说是哪台机器',
    noCustomer: '这条事故没说是哪位客户',
    noSourcesPage: '数据源还没有自己的页面',
  } as const,
  incidentRetirePreview: '带你去这台机器的详情页，下架和退役都在那儿，按之前会先算清楚影响谁。',
  incidentDrawer: {
    timeline: '时间线',
    affected: '受影响客户',
    evidence: '证据',
    actions: '动作',
    deliveries: '推送记录',
    notePrompt: '写一句备注',
    noteSend: '记下',
  } as const,
  incidentEvent: {
    opened: '开始',
    escalated: '升级',
    deescalated: '降级',
    acked: '已认领',
    snoozed: '已静默',
    note: '备注',
    job: '执行',
    alert: '推送',
    resolved: '已恢复',
  } as const,
  deliveryStatus: {
    pending: '待发',
    sent: '已发',
    failed: '没发出去',
    suppressed: '没重复推送',
  } as const,
  jobStatus: {
    queued: '排队中',
    leased: '执行中',
    succeeded: '成功',
    failed: '失败',
    cancelled: '已取消',
    expired: '已过期',
  } as const,
  emptyIncidents: '没有进行中的事故',
  emptyResolved: '最近 7 天没有恢复记录',
  actionFailed: '动作没做成',
  choreKindOther: '待办',
  choreKind: {
    renew: '续费',
    quota: '额度',
    expiry: '到期',
    version: '版本过旧',
    profile: '缺资料',
  } as const,
  chore: {
    nodeRenew: (node: string, when: string) => `${node} ${when} 续费`,
    nodeQuota: (node: string, pct: string) => `${node} 本期流量已用 ${pct}`,
    nodeProfile: (node: string) => `${node} 还没登记价格与续费日`,
    customerExpiry: (who: string, when: string) => `${who} ${when} 到期`,
    customerQuota: (who: string, pct: string) => `${who} 本期流量已用 ${pct}`,
    customerVersion: (who: string, version: string) => `${who} 还在跑 ${version}`,
    customerProfile: (who: string) => `${who} 没上报过平台与版本`,
  },
  /* --------------------------------------------------------------- 证据 */

  /**
   * 证据, in the words the operator would use out loud.
   *
   * The engine writes the measurement it fired on as a small object, and the
   * drawer used to print that object's key names beside its values — a person
   * reading "blockStatus" and a quoted string. Each line below is the same
   * measurement said as a sentence; anything the engine adds later falls back
   * to its own name and a readable value rather than braces.
   */
  evidence: {
    scan: (word: string) => `大陆扫描：${word}`,
    observedNow: (word: string) => `这一轮测出来：${word}`,
    verdictNow: (word: string) => `现在的判断：${word}`,
    exitUp: '出口通',
    exitDown: '出口不通',
    exitUnknown: '出口通不通还没测',
    agentHeard: (when: string) => `探针最后说话 ${when}`,
    agentSilent: '探针没说过话',
    scanAt: (when: string) => `上次大陆扫描 ${when}`,
    scanNever: '还没扫过大陆',
    agentsAt: (when: string) => `上次收探针 ${when}`,
    agentsNever: '还没收到过探针',
    lossOne: (carrier: string, pct: string) => `${carrier}回程丢包 ${pct}`,
    lossNone: '三网回程都没丢包',
    fails: (failures: string, attempts: string, users: string) =>
      `30 分钟内 ${failures} 次失败（共 ${attempts} 次），${users} 位客户`,
    handshake: (users: string) => `握手就失败的有 ${users} 位客户`,
    machine: (load: string, mem: string) => `负载 ${load}，内存 ${mem}`,
    machineCpu: (cpu: string) => `CPU ${cpu}`,
    machineDisk: (disk: string) => `磁盘 ${disk}`,
    errorSpikeYes: '后台报错比平时多',
    errorSpikeNo: '后台报错不算多',
    occupancy: (n: string) => `还有 ${n} 人在用`,
    listedYes: '还在客户端的节点单子里',
    listedNo: '已经不在客户端的节点单子里',
    listedUnknown: '在不在单子里还不知道',
    onNode: (node: string) => `当前节点 ${node}`,
    delay: (ms: string) => `出口耗时 ${ms}`,
    streak: (n: string) => `连着 ${n} 轮都偏慢`,
    failCount: (n: string) => `30 分钟内失败 ${n} 次`,
    lastFail: (when: string) => `最近一次失败 ${when}`,
    lastOk: (when: string) => `最近一次连上 ${when}`,
    switches: (n: string) => `一天里换了 ${n} 次节点`,
    /** Whatever the engine started writing this week: its own name, readable. */
    other: (label: string, value: string) => `${label} ${value}`,
    yes: '是',
    no: '否',
  },

  commandCustomers: '客户',
  commandIncidents: '事故',
} as const;
