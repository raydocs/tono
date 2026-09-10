/**
 * Every word the 设置 page says.
 *
 * It lives beside `copy.ts` rather than inside it because one page's strings
 * are four hundred lines on their own, and the file budget is the same for
 * copy as for anything else. `copy.ts` spreads it back in, so callers still
 * read one object.
 *
 * 设置 is deliberately plain: no health words, no tones. Everything here is a
 * noun the operator already uses out loud, and every explanation says what
 * happens rather than what is stored.
 */
export const settingsCopy = {
  /** The rail, in the order an operator walks it. */
  sections: {
    alerts: '告警',
    catalog: '目录',
    policy: '分流规则',
    homeinventory: '家宽库存',
    homelines: '家宽资产',
    providers: '商家账号',
    candidates: '直连候选',
    allowlist: '注册白名单',
    audit: '操作记录',
  } as const,
  /** One line under the heading: why you would be on this section at all. */
  sectionLead: {
    alerts: '什么事值得半夜叫醒你，往哪儿发。',
    catalog: '客户端下次拉到的节点单子，就是这一份。',
    policy: '哪些站点不走隧道，客户端照这一份走。',
    homeinventory: '手上有哪些家宽线路，能不能分给客户。',
    homelines: '家宽线路的到期、计费和这一期用了多少。',
    providers: '节点和域名挂在谁家名下，账单去哪儿交。',
    candidates: '这些站点看着不必走隧道，接受还是拒绝由你定。',
    allowlist: '哪些邮箱能自己注册账号。',
    audit: '谁在什么时候动了什么。',
  } as const,

  /* ------------------------------------------------------------ 通用动作 */

  create: '新建',
  save: '保存',
  cancel: '取消',
  remove: '删除',
  saving: '保存中',
  savedNothing: '没有要改的',
  required: '这一栏得填',
  copyText: '复制',
  copied: '已复制',
  openLink: '打开',
  yes: '是',
  no: '否',

  /** Seconds, said the way an operator says them. */
  duration: {
    seconds: (n: number) => `${n} 秒`,
    minutes: (n: number) => `${n} 分钟`,
    hours: (n: number) => `${n} 小时`,
    days: (n: number) => `${n} 天`,
    none: '不等',
  },

  /* ---------------------------------------------------------------- 告警 */

  alerts: {
    rules: '告警规则',
    newRule: '新建规则',
    editRule: '改规则',
    test: '发送测试',
    tested: '测试已发出',
    ruleCount: (n: number) => `${n} 条规则`,
    empty: '还没有告警规则，出事没人会被叫醒',
    columns: {
      name: '名称',
      enabled: '启用',
      minSeverity: '最低严重度',
      delay: '延迟',
      cooldown: '冷却',
      channel: '通道/模板',
      lastFired: '最近触发',
      action: '',
    } as const,
    on: '开',
    off: '关',
    channel: {
      webhook: '回调',
      email: '邮件',
    } as const,
    template: {
      telegram: 'Telegram',
      feishu: '飞书',
      slack: 'Slack',
      generic: '通用',
    } as const,
    fireOn: {
      open: '只在出事时',
      open_resolve: '出事和恢复都发',
    } as const,
    fields: {
      name: '名称',
      enabled: '启用',
      minSeverity: '最低严重度',
      minImpact: '最少影响人数',
      fireOn: '什么时候发',
      delaySeconds: '延迟几秒再发',
      cooldownSeconds: '冷却多少秒',
      channel: '通道',
      target: '发到哪儿',
      template: '模板',
      secretRef: '凭据名',
      matchKind: '只看这类事',
      matchSubjectType: '只看这类对象',
      matchSubjectId: '只看这一个对象',
    } as const,
    hints: {
      delaySeconds: '事故先扛过这段时间才推，抖一下就好的不打扰你。',
      cooldownSeconds: '同一件事在这段时间里只推一次，其余记成没重复推送。',
      secretRef: '这里只填凭据的名字，不要填内容本身。',
      matchKind: '留空就是全都要。',
      target: '回调填地址，邮件填收件人。',
      minImpact: '影响人数不到这个数就不推。',
    } as const,
    deliveries: '最近投递',
    deliveriesEmpty: '还没有推送过',
    deliveryWhy: {
      pending: '排着，还没发',
      sent: '发出去了',
      failed: '发的时候出错了',
      suppressed: '冷却中未发',
    } as const,
    transition: {
      open: '出事',
      escalate: '升级',
      resolve: '恢复',
      test: '测试',
    } as const,
    deleteTitle: '删掉这条规则？',
    deleteBody: (name: string) => `删掉「${name}」之后，符合它的事故不再往外推。已经发出去的记录会留着。`,
  },

  /* ------------------------------------------------------------ 商家账号 */

  providers: {
    title: '商家账号',
    newAccount: '新建账号',
    editAccount: '改账号',
    count: (n: number) => `${n} 个账号`,
    empty: '还没有登记商家账号',
    columns: {
      provider: '商家',
      label: '标签',
      cloudKind: '类型',
      loginEmail: '登录邮箱',
      billingUrl: '账单页',
      nodeCount: '节点数',
      action: '',
    } as const,
    cloudKind: {
      vps: '云主机',
      cloudflare: 'Cloudflare',
      domain_registrar: '域名商',
      residential: '家宽',
      other: '其他',
    } as const,
    fields: {
      provider: '商家',
      label: '标签',
      cloudKind: '类型',
      loginEmail: '登录邮箱',
      billingUrl: '账单页',
      balanceHint: '余额备忘',
      renewNotes: '续费备忘',
      secretRef: '凭据名',
    } as const,
    hints: {
      loginEmail: '存进去之前就打过码，只用来认人，认不出来再去密码管理器翻。',
      secretRef: '这里只填凭据的名字，不要填内容本身。',
      billingUrl: '交钱的那一页，续费的时候直接点。',
      label: '你自己叫它什么，列表里显示这个。',
    } as const,
    unit: (n: number) => `${n} 台`,
    deleteTitle: '关掉这个账号？',
    deleteBody: (label: string) => `关掉「${label}」之后，它不再出现在这张表里。已经登记在它名下的节点不受影响，账单也不会自己停。`,
  },

  /* ------------------------------------------------------------ 家宽资产 */

  homelines: {
    title: '家宽线路',
    newLine: '新建线路',
    editLine: '改线路',
    count: (n: number) => `${n} 条线路`,
    empty: '还没有登记家宽线路',
    columns: {
      line: '线路',
      status: '状态',
      place: '运营商/地区',
      billing: '计费',
      expires: '到期',
      usage: '本期用量',
      probe: '探测',
      action: '',
    } as const,
    status: {
      active: '在用',
      retired: '已退',
      paused: '暂停',
    } as const,
    billingKind: {
      monthly: '包月',
      per_gb: '按流量',
      bundle: '套餐包',
    } as const,
    meterSource: {
      client_route: '客户端',
      node_stats: '节点',
      provider_api: '商家',
      manual: '手填',
    } as const,
    probeAlive: (alive: number, total: number) => `${alive}/${total} 通`,
    fields: {
      proxyName: '线路代号',
      displayName: '线路名字',
      isp: '运营商',
      region: '地区',
      providerAccountId: '挂在哪个账号',
      price: '价格',
      currency: '币种',
      billingKind: '怎么计费',
      bundleBytes: '套餐流量',
      cycleStart: '本期起',
      cycleEnd: '本期止',
      expiresAt: '到期',
      meterSource: '用量从哪儿来',
      notes: '备注',
    } as const,
    hints: {
      proxyName: '线路在配置里的那个名字，建好就别改了。',
      bundleBytes: '按 GB 填，包月不限量就留空。',
      cycleStart: '按天填，格式 2026-09-01。',
      meterSource: '同一条线三个地方都能报数，这里说以谁为准。',
    } as const,
    usageStrip: '最近 30 天，每根一天',
    usageEmpty: '这条线还没有报过用量',
    facts: {
      up: '上行',
      down: '下行',
      users: '在用人数',
      cycle: '本期',
      price: '价格',
    } as const,
    deleteTitle: '退掉这条线路？',
    deleteBody: (name: string) => `「${name}」会记成已退，不再分给客户。已经记下的用量和账单不动。`,
  },

  /* ------------------------------------------------------------ 直连候选 */

  candidates: {
    title: '直连候选',
    count: (n: number) => `${n} 个域名`,
    empty: '没有待定的域名',
    all: '全部',
    status: {
      new: '待定',
      accepted: '已接受',
      rejected: '已拒绝',
      already_direct: '本来就直连',
    } as const,
    columns: {
      etld1: '域名',
      country: '解析到',
      users: '几个人在用',
      bytes: '30 天流量',
      firstSeen: '第一次看到',
      decided: '谁定的',
      action: '',
    } as const,
    accept: '接受',
    reject: '拒绝',
    countryUnknown: '还没查',
    draft: '生成分流草案',
    draftTitle: '分流草案',
    draftLead: '这里只出草案，不改线上的分流规则。装进编辑器之后还得自己按发布。',
    draftEmpty: '还没有接受过任何域名，草案是空的',
    userUnit: (n: number) => `${n} 人`,
  },

  /* ---------------------------------------------------------- 注册白名单 */

  allowlist: {
    title: '注册白名单',
    count: (n: number) => `${n} 个邮箱`,
    empty: '名单是空的，现在没人能自己注册',
    /** The line that stops an operator adding every customer by hand. */
    note: '开通客户时会自动加入，这里管的是手工加的那些。',
    add: '添加',
    field: '邮箱',
    fieldHint: '客户注册时用的那个地址，大小写不算数。',
    invalid: '这不像一个邮箱',
    already: (email: string) => `${email} 本来就在名单里`,
    added: (email: string) => `${email} 加进来了`,
    columns: {
      email: '邮箱',
      createdAt: '加进来的时间',
      action: '',
    } as const,
    deleteTitle: '从名单里去掉？',
    deleteBody: (email: string) => `去掉之后，${email} 再注册会被挡回去。已经开通的账号不受影响。`,
  },

  /* ------------------------------------------------------------ 操作记录 */

  audit: {
    title: '操作记录',
    empty: '这段时间没人动过什么',
    columns: {
      at: '时间',
      actor: '操作者',
      action: '动作',
      target: '对象',
      summary: '摘要',
    } as const,
    actorType: {
      access_admin: '管理员',
      token_admin: '令牌',
      collector: '采集',
      exit_node: '节点',
      system: '系统',
    } as const,
    actorUnknown: '没记名字',
    filterTarget: '只看',
    filterTargetHint: '点一行，就只看那一个对象。',
    clearFilter: '不筛了',
    more: '加载更多',
    loadingMore: '正在取',
  },
} as const;
