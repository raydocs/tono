// The shell, the fleet, and the words every page borrows: sources, health
// words, relative time, units.

/** Named once so the pill's two forms cannot drift apart. */
const SOURCE_OK = '数据源 正常';

export const shellCopy = {
  brand: 'Tono',
  brandSub: '运维',
  pages: {
    today: '今天',
    nodes: '节点',
    customers: '客户',
    clients: '客户端',
    settings: '设置',
    traffic: '用量',
  } as const,
  legacyFilterNotice: '旧入口的筛选或搜索范围不能完全等价迁移，已保留可用的关键词与对象链接；请在此重新核对筛选。',
  emptyMigrated: '还没有可展示的数据',
  searchPrompt: '搜索客户、节点或功能',
  navigation: {
    label: '业务导航',
    more: '更多',
    close: '关闭导航',
    description: '按业务找到客户、线路、账目和管理功能。',
    groups: {
      workbench: '工作台',
      customers: '客户与接入',
      resources: '节点与线路',
      finance: '财务经营',
      system: '系统管理',
    },
    aliases: {
      today: ['首页', '事故', '待办', '诊断'],
      nodes: ['服务器', '机器', '出口'],
      customers: ['用户', '开通', '续费'],
      clients: ['发布', '版本', '更新'],
      alerts: ['通知', '告警规则'],
      catalog: ['节点目录'],
      policy: ['路由', '分流'],
      homeinventory: ['家宽', '住宅', '库存'],
      homelines: ['家宽', '线路', '资产', '到期'],
      ledger: ['财务', '收入', '支出', '月结'],
      providers: ['供应商', '商家', '账号'],
      candidates: ['直连', '候选'],
      allowlist: ['注册', '白名单'],
      audit: ['审计', '操作记录'],
      traffic: ['流量', '累计', '小时用量', 'traffic'],
    },
  },
  commandEmpty: '没有匹配项',
  commandPages: '页面',
  commandNodes: '节点',
  theme: {
    system: '跟随系统',
    light: '浅色',
    dark: '深色',
  } as const,
  privacy: '隐私',
  /** The avatar menu: everything that is a preference rather than a fact. */
  preferences: '偏好',
  appearance: '外观',
  sourceOk: SOURCE_OK,
  sourceFresh: (when: string) => `${SOURCE_OK} · ${when}`,
  sourceUnknown: '数据源 未知',
  /**
   * The header capsule names the weakest source, because that is the one that
   * decides how much of the page can be trusted. 未接 is deliberately not an
   * alarm: an executor nobody has installed yet is expected, and a red pill for
   * it would teach the operator to ignore the pill.
   */
  sourceLate: (who: string, lasting: string) => `${who} 停了 ${lasting}`,
  sourceGone: (who: string) => `${who} 未接`,
  sourceBroken: (who: string) => `${who} 不通`,
  /** The hover list: every source, how it is doing, and when it last spoke. */
  sourceState: {
    ready: '正常',
    stale: '停了',
    error: '不通',
    missing: '未接',
  } as const,
  sourceLine: (who: string, state: string, when: string) => `${who} ${state} · ${when}`,
  sourceLineNever: (who: string, state: string) => `${who} ${state}`,
  /**
   * How old the page in front of you is. An old displayed read must remain
   * visible even when another request succeeds, rather than leaving the
   * reader to infer its age from numbers that look as current as ever.
   */
  pageAsOf: (when: string) => `本页截至 ${when}`,
  pageStale: '本页数据可能不是最新',
  consoleStale: '后台没响应',
  /**
   * Right after a deploy the pages read as silent for hours while thirty days
   * of telemetry are worked through. This says so, with how far along it is,
   * instead of letting the page look broken.
   */
  backfilling: (done: string, total: string, minutes: string) =>
    `正在回填 30 天遥测：已处理 ${done} / ${total}，约 ${minutes} 分钟后齐`,
  sessionExpired: '登录已过期',
  sessionExpiredBody: '登录已过期，页面上的数据不会再更新。重新登录后继续。',
  reload: '重新登录',
  pathNotWired: '客户去程数据尚未接入',
  renew: '续费/到期',
  lastMeasured: '最后测量',
  missing: '—',
  noQuota: '未设额度',
  exhaustEta: '预计耗尽',
  remaining: '剩余',
  status: '状态',
  node: '节点',
  inUse: '在用',
  loading: '载入中',
  loadError: '载入失败',
  emptyList: '没有节点',
  tableError: '表格没载入上来',
  retry: '重试',
  close: '关闭',
  facts: {
    ip: '地址',
    os: '系统',
    provider: '供应商',
    tags: '线路',
    ports: '端口',
  } as const,
  sources: {
    agent: '探针',
    quality: '质量',
    catalog: '目录',
    profile: '画像',
    live: '三网',
    none: '未接入',
  } as const,
  /** Who measured it, in one word — the second half of every `—`. */
  sourceWord: {
    collector: '采集',
    komari: '探针',
    telemetry: '上报',
    catalog: '目录',
    profile: '画像',
    engine: '判定',
    jobs: '任务',
    manual: '手填',
  } as const,
  health: {
    lost: '失联',
    blocked: '被墙',
    degraded: '劣化',
    ok: '正常',
    unmeasured: '未测',
  } as const,
  /** The worst carrier on each leg, as the card prints it. */
  worstCarrier: (who: string, first: string, second: string) => `${who} ${first} · ${second}`,
  /** A span, not a point: "已持续 2 小时" reads wrong as "2 小时前". */
  lasting: {
    now: '不到 1 分钟',
    minutes: (n: number) => `${n} 分钟`,
    hours: (n: number) => `${n} 小时`,
    days: (n: number) => `${n} 天`,
  },
  ago: {
    now: '刚刚',
    minutes: (n: number) => `${n} 分钟前`,
    hours: (n: number) => `${n} 小时前`,
    days: (n: number) => `${n} 天前`,
  },
  unit: {
    person: '人',
    ms: 'ms',
    pct: '%',
  },
} as const;
