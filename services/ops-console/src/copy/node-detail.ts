/**
 * 节点详情 page copy.
 *
 * Split out of `copy.ts` only because that file is already at its line budget;
 * it is spread back in there, so every string on these pages is still reached
 * as `copy.something` and there is still exactly one place to read the
 * console's whole vocabulary.
 *
 * Two rules the wording follows. Consequences are written in the operator's
 * terms — what the customer will feel — because a confirmation that repeats
 * the button's own label ("确认下架") is not a confirmation. And nothing here
 * says how anything is stored or computed: the page shows what was measured
 * and what an action will do, never the machinery in between.
 */
export const nodeDetailCopy = {
  nodeOpenPage: '打开详情',
  nodeLifecycle: {
    listed: '在售',
    unlisted: '已下架',
    retired: '已退役',
  } as const,
  nodeCatalog: {
    listed: '在客户端单子里',
    unlisted: '不在客户端单子里',
    unknown: '在不在单子里还不知道',
  } as const,
  nodeSections: {
    acceptance: '可售验收',
    facts: '这台机器',
    bindings: '五处登记',
    quota: '本周期流量',
    load: '机器负载',
    forward: '客户连得上吗',
    back: '大陆回得来吗',
    qualityText: '线路原文',
    occupancy: '现在谁在用',
    errors: '后台报错',
    connections: '最近连接',
    jobs: '任务',
    history: '变更记录',
  } as const,

  nodeFacts: {
    ip: '地址',
    os: '系统',
    provider: '商家',
    account: '商家账号',
    tags: '线路标签',
    port: '端口',
    price: '价格',
    renew: '续费',
    expires: '到期',
    notes: '备注',
  } as const,
  nodeAccountLink: '看这个商家账号',
  nodePrice: (money: string, cycle: string) => `${money} / ${cycle}`,
  nodeCycleDays: (days: string) => `${days} 天`,
  nodeWhenBoth: (relative: string, absolute: string) => `${relative} · ${absolute}`,
  /** 续费 and 到期 point forwards; "刚刚" for a date next month is a lie. */
  nodeAhead: {
    soon: '就这几个小时',
    hours: (count: string) => `${count} 小时后`,
    days: (count: string) => `${count} 天后`,
  },

  /* --------------------------------------------------------- 可售验收 */

  /** The verdict line, in the two answers the operator actually acts on. */
  nodeAcceptanceReady: '可以上架',
  nodeAcceptanceShort: (count: string) => `还差 ${count} 项`,
  /**
   * The state word beside each line. 没测 and 不行 are deliberately not the
   * same word: a check nobody has run is a thing to go and do, and a check
   * that came back bad is a thing to go and fix.
   */
  nodeAcceptanceState: {
    pass: '已核',
    fail: '不行',
    unknown: '没测',
    pending: '在测',
  } as const,
  nodeAcceptanceAsOf: '核对于',
  nodeAcceptanceNever: '还没核对过',
  nodeAcceptanceNoEvidence: '没有留下依据',
  nodeAcceptanceBlockers: (what: readonly string[]) => `挡着上架的：${what.join('、')}`,
  nodeAcceptanceListedNote: '这台机器已经在售，这张单子留着复核',
  /** The second path: it exists, it is not the default, and it is recorded. */
  nodeAcceptanceOverride: '仍要上架',
  nodeAcceptanceOverrideLead: (what: readonly string[]) => `下面这几项还没过，上架会记在案上：${what.join('、')}。`,

  nodeBindingLabels: {
    catalog: '目录',
    exitToken: '出口令牌',
    komari: 'Komari',
    identitySync: '身份同步',
    metering: '计量',
  } as const,
  nodeBindingsAllDone: '五处都登记好了',
  nodeBindingTodo: (what: string) => `${what} 还没登记`,
  nodeBindingsAsOf: '核对于',
  nodeBindingsNever: '还没核对过',

  nodeQuotaCycle: (from: string, to: string) => `本周期 ${from} 到 ${to}`,
  nodeQuotaNoCycle: '没登记周期起止',

  /**
   * The verdict as a word, for the places that show what was measured rather
   * than how the machine is right now — the 证据 lines on 今天, mostly.
   */
  nodeVerdictWord: {
    down: '整机失联',
    blocked: '疑似被墙',
    no_probe: '没有探针',
    degraded: '回程丢包',
    pressure: '高负载',
    unknown: '还没测到',
    ok: '大陆正常',
  } as const,
  /**
   * 凭什么, when the engine hands over a bare token instead of a sentence.
   *
   * The engine writes one word — the rule that fired — and a page that prints
   * it is a page that says `carrier_loss` to an operator. Every token it can
   * write has a sentence here; anything unmapped shows nothing rather than the
   * token, because a word nobody can read is worse than a quiet line.
   */
  nodeReason: {
    unreachable: '整机连不上，探针也没有声音',
    likely_blocked: '大陆三网都握不上手，像是被墙了',
    agent_missing: '这台机器在售，但上面没有探针',
    machine_pressure: '机器自己吃紧了：负载、内存或磁盘快满了',
    snapshot_stale: '最近一轮没有测到这台机器',
    carrier_loss: '回程丢包偏高',
    customer_fail: '客户连这台机器反复失败',
    error_spike: '后台报错突然变多',
    collector_stale: '采集端最近没有送来新数据',
  } as const,

  nodeCarrier: {
    unicom: '联通',
    telecom: '电信',
    mobile: '移动',
    other: '其他',
  } as const,
  nodeForwardColumns: {
    carrier: '运营商',
    okRate: '成功率',
    tcp: '中位 TCP',
    worst: '最多的失败',
    tries: '尝试/用户',
  } as const,
  nodeReturnColumns: {
    carrier: '运营商',
    loss: '丢包',
    latency: '延迟',
  } as const,
  nodePathNote: '回程好不代表客户连得上',
  nodeTries: (attempts: string, users: string) => `${attempts} / ${users}`,
  nodeNoForward: '还没有客户从大陆连过这台机器',
  nodeNoReturn: '中控机还没扫过这台机器',

  nodeOccupantColumns: {
    customer: '客户',
    device: '设备与平台',
    version: '版本',
    online: '在线',
    lastSeen: '最近',
  } as const,
  nodeOnline: '在线',
  nodeOffline: '离线',
  nodeNoOccupants: '现在没人用这台机器',

  nodeErrorRange: {
    week: '最近 7 天',
    month: '最近 30 天',
  } as const,
  nodeErrorTimes: (count: string) => `${count} 次`,
  nodeErrorSample: '最近一条',
  nodeNoErrors: '这段时间没有后台报错',

  nodeNoConnections: '这台机器最近没有连接记录',

  nodeJobColumns: {
    type: '类型',
    status: '状态',
    who: '发起人',
    created: '创建',
    result: '结果',
    action: '',
  } as const,
  nodeJobType: {
    xray_dial_errors: '拉取报错',
    xray_error_digest: '汇总报错',
    collect_quality: '采一次质量',
    node_probe: '重测大陆可达',
    node_config_snapshot: '抓一份配置',
    xray_restart: '重启 Xray',
    identity_sync: '同步身份',
    agent_reinstall: '重装探针',
    catalog_retire: '下架',
    catalog_relist: '上架',
    home_line_probe: '测家宽线路',
  } as const,
  nodeJobCancel: '取消',
  nodeJobCancelBlocked: '这条已经跑完了，取消不了',
  nodeNoJobs: '还没有给这台机器派过活',

  nodeNoHistory: '还没有变更记录',
  nodeHistoryNoReason: '没写原因',

  nodeActions: {
    unlist: '下架',
    relist: '上架',
    identitySync: '同步身份',
    pullErrors: '拉取报错',
    restart: '重启 Xray',
    probe: '重测大陆可达',
    retire: '退役',
  } as const,
  /** What the operator will have done once they press the button. */
  nodeActionConsequence: {
    unlist: '客户端下次取节点单子时就看不到这台机器了；现在连着的人会被换到别的节点。',
    relist: '这台机器会重新出现在客户端的节点单子里，随后就会有人连上来。',
    identitySync: '这台机器上的账号会被改成控制台里的那份；现在连着的人会断一下，客户端自己会连回来。',
    pullErrors: '去这台机器上取最近的后台报错，取回来就显示在这一页。什么都不改。',
    restart: '这台机器上的 Xray 会重启；现在连着的人会断一下，客户端自己会连回来。',
    probe: '从大陆三网重新测一遍这台机器。什么都不改。',
    retire: '把这台机器从目录里彻底摘掉并标成已退役；它不会再回到客户端的节点单子里。',
  } as const,
  nodeActionDialogTitle: (label: string) => `${label}：先看清楚`,
  nodeActionGo: (label: string) => `就${label}`,
  nodeActionBack: '不做了',
  nodeActionTypeName: '把节点名原样打一遍，确认是这台机器',
  nodeActionNameMismatch: '和节点名不一样',
  nodeActionQueued: (label: string) => `${label} 已经派出去了`,
  nodeActionRetired: (name: string) => `${name} 已经退役`,
  nodeActionBlocked: {
    retired: '这台机器已经退役了',
    hub: '中控机现在连不上这台机器',
    notListed: '这台机器现在不在售',
    alreadyListed: '这台机器已经在售',
    unknownListing: '还不知道这台机器在不在售',
    notSellable: (count: string, what: readonly string[]) => `验收还差 ${count} 项：${what.join('、')}`,
    acceptanceUnread: '还没读到这台机器的验收单',
  } as const,

  /* ------------------------------------------------- 这台机器：手填的那部分 */

  nodeEdit: '编辑',
  nodeProfileTitle: (name: string) => `${name}：这台机器`,
  nodeProfileLead: '这一页的价格、续费和额度没有别的来源，只有这里填过才有。',
  nodeProfileFields: {
    provider: '商家',
    account: '商家账号',
    region: '地区',
    tags: '线路标签',
    port: '端口',
    price: '价格',
    currency: '货币',
    cycle: '账期',
    renew: '续费日',
    expires: '到期日',
    notes: '备注',
  } as const,
  nodeProfileHints: {
    tags: '手工确认过的线路，用顿号或者中点隔开',
    cycle: '一期多少天，按账单上的写',
    currency: '账单上的写法：$ 或者 USD',
    quotaBytes: '按商家卖的数字填，单位 GB',
    anchorDay: '每月第几天翻页，1 到 28',
  } as const,
  nodeProfileAccountNone: '还没挂到账号上',
  nodeProfileQuota: '本周期流量',
  nodeProfileQuotaOn: '登记了额度',
  nodeProfileQuotaOff: '不登记额度',
  nodeQuotaFields: {
    bytes: '额度',
    kind: '怎么翻页',
    anchorDay: '每月第几天',
    counts: '算哪个方向',
  } as const,
  nodeQuotaKind: {
    calendar_day: '每月固定某天',
    anniversary: '按开通日',
    rolling_30d: '滚动 30 天',
    manual: '自己手动清',
  } as const,
  nodeQuotaCounts: {
    in: '只算下行',
    out: '只算上行',
    in_out: '上下行都算',
  } as const,
  nodeProfileSaved: '这台机器的资料已经改好了',

  nodeRetireReason: '为什么退役',
  nodeRetireReasonPrompt: '写一句原因',
  nodeRetireAffected: (count: string) => `会影响 ${count} 位正在用的客户`,
  nodeRetireNoneAffected: '现在没有人用这台机器',
  nodeRetireUnsafe: '现在不能退役',
  nodeRetireLoading: '正在看退役会发生什么',

  /* ----------------------------------------------------------- 机器负载 */

  nodeLoadRange: {
    '24h': '24 小时',
    '7d': '7 天',
  } as const,
  nodeLoadCharts: {
    cpu: 'CPU',
    memory: '内存',
    netIn: '下行',
    netOut: '上行',
  } as const,
  nodeLoadPeak: (value: string) => `峰值 ${value}`,
  /** 95 分位 is how transit is billed; 并发峰值 is what the box was holding. */
  nodeLoadBandwidth: '95 分位带宽',
  nodeLoadConnections: '并发峰值',
  nodeLoadRate: (bytes: string) => `${bytes}/s`,
  nodeLoadConnCount: (count: string) => `${count} 条`,
  nodeLoadPoint: (when: string, value: string) => `${when} · ${value}`,
  /**
   * The one thing about these charts that is not obvious from looking at
   * them: the machine reports totals since it booted, so a restart leaves a
   * hole rather than a cliff, and the hole is the honest drawing.
   */
  nodeLoadNote: '上下行按两次上报之间的增量算，机器重启过的那一段不画',
  nodeNoLoad: '这台机器最近没有报过负载',

  /* ----------------------------------------------------------- 线路原文 */

  nodeQualityParts: {
    security: '端口与风险',
    backtrace: '回程',
  } as const,
  nodeQualityCopy: '复制',
  nodeQualityCopied: '已复制',
  nodeNoQualityText: '中控机还没留下这台机器的扫描原文',
} as const;
