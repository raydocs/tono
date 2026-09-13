/**
 * The words for the three 设置 sections that change what customers get.
 *
 * They sit apart from `settings.ts` because that file was already at the size
 * budget, and because these three share a shape the other five do not: a
 * document you edit, a comparison against what is live, and a sentence that
 * says what happens to every client the moment you press 发布. `copy.ts`
 * spreads both halves into one `copy.settings`, so callers still read one
 * object.
 *
 * Every confirming sentence here names the blast radius rather than asking
 * 确定吗. There is one operator, the fleet is what they are holding, and the
 * last thing read before the click has to be what the click does to it.
 */
export const settingsPublishCopy = {
  /* ---------------------------------------------------------------- 目录 */

  catalog: {
    title: '节点目录',
    online: (n: number) => `线上 r${n}`,
    never: '还没发过',
    updated: '更新时间',
    edit: '开始编辑',
    editorLabel: '节点目录原文',
    reload: '重新取线上版',
    reloadTitle: '重新取会把编辑框里的东西盖掉？',
    reloadBody: '线上版没取回来之前编辑框不动；取到了才替换。你现在写的这一份不会留下。',
    reloadDone: (n: number) => `编辑框里现在是线上的 r${n}`,
    clean: '和线上版一模一样，没有要发的东西',
    changed: (added: number, removed: number) => `多 ${added} 行，少 ${removed} 行`,
    truncated: '改动太多，下面只画了前面几处',
    nodeCount: (n: number) => `${n} 台`,
    publish: '发布',
    publishTitle: '把这份目录发出去？',
    publishBody: '这会改变所有客户端下次拉取的节点单子。发出去之后，每台客户端下一次取目录拿到的就是这一份；已经连上的连接不会立刻断，但换节点时按这份来。',
    published: (was: number, now: number) => `线上从 r${was} 变成了 r${now}`,
    conflictTitle: '线上目录在你改的这段时间里变过了',
    conflictBody: (was: number, now: number) => `你这份是照着 r${was} 改的，线上现在是 r${now}，所以没有发出去。线上那版已经重新取回来放在下面，请自己把改动合过去再发一次。`,
    conflictDiff: (added: number, removed: number) => `和你的底稿比，线上多了 ${added} 行，少了 ${removed} 行。`,
    /** Why this draft is not publishable — the same gates the hub applies. */
    fault: {
      empty: '编辑框是空的，或者短得不像一份目录',
      tooBig: '这份太大了，送不上去',
      controlChar: '里面有看不见的控制字符，先清掉再发',
      noProxies: '找不到 proxies: 这一节，客户端读不出节点',
      unreadable: 'proxies: 底下的清单读不出来',
      identity: '每台节点都要有且只有一个 uuid: {{TONO_CLIENT_UUID}}',
    } as const,
    history: '发布历史',
    historyEmpty: '还没有发过',
    historyColumns: {
      version: '版本',
      nodes: '台数',
      at: '时间',
      sha: '指纹',
    } as const,
    current: '线上这版',
  },

  /* ------------------------------------------------------------ 分流规则 */

  policy: {
    title: '分流规则',
    online: (n: number) => `线上 r${n}`,
    never: '还没发过',
    updated: '更新时间',
    signed: '线上这版带着签名',
    unsigned: '线上这版没签名',
    edit: '开始编辑',
    editorLabel: '分流规则原文',
    reload: '重新取线上版',
    reloadTitle: '重新取会把编辑框里的东西盖掉？',
    reloadBody: '线上版没取回来之前编辑框不动；取到了才替换。你现在写的这一份不会留下。',
    reloadDone: (n: number) => `编辑框里现在是线上的 r${n}`,
    clean: '和线上版一模一样，没有要发的东西',
    changed: (added: number, removed: number) => `多 ${added} 行，少 ${removed} 行`,
    truncated: '改动太多，下面只画了前面几处',
    publish: '发布',
    publishTitle: '把这份分流规则发出去？',
    publishBody: '这会改变所有客户端下次拉取的分流规则：名单里的站点不再走隧道，直接从本机出去。发出去之后每台客户端下一次取规则就照这份走。',
    published: (was: number, now: number) => `线上从 r${was} 变成了 r${now}`,
    conflictTitle: '线上规则在你改的这段时间里变过了',
    conflictBody: (was: number, now: number) => `你这份是照着 r${was} 改的，线上现在是 r${now}，所以没有发出去。线上那版已经重新取回来放在下面，请自己把改动合过去再发一次。`,
    conflictDiff: (added: number, removed: number) => `和你的底稿比，线上多了 ${added} 行，少了 ${removed} 行。`,
    fault: {
      json: '这不是一段能读的 JSON',
      shape: '字段对不上。客户端只认第 1 到第 4 版，每一版有哪些字段是定死的',
    } as const,
    /** What the hub says no with; anything else falls back to 动作没做成. */
    refusal: {
      TRAFFIC_POLICY_SIGNATURE_INVALID: '这个签名盖不住服务端要存的那份原文，重新签一次',
      TRAFFIC_POLICY_KEY_UNCONFIGURED: '这套后端没配验签的公钥，签了也收不下',
    } as const,
    dryRun: '试运行',
    dryRunLead: '不动线上。让服务端照这份算一遍，看它最后会存成什么样、要不要签名。',
    canonical: '服务端会存成这样',
    dryRunStale: '编辑框又改过了，下面这份是上一次试运行的结果',
    needSignature: '这份要签名才发得出去',
    noSignature: '这份不签名也能发',
    signature: '签名',
    signatureHint: '拿离线私钥签完贴进来。这边只往上送一次，不留底。',
    signatureContext: '要签的内容是这一行前缀，直接接上上面那段原文',
    signatureMissing: '先试运行，拿到要签的原文再签',
    quick: '快捷改法',
    closeWeb: '关闭网页直连',
    closeAll: '关掉全部直连',
    closedWeb: '网页直连已经从编辑框里去掉了，还没发布',
    closedAll: '所有直连都从编辑框里去掉了，还没发布',
    noWeb: '这一份里本来就没有网页直连',
    quickHint: '两个都只改编辑框里的草稿，改完还得自己按发布。',
    draftLoaded: '直连候选的草案已经放进编辑框，还没发布',
    loadDraft: '把草案装进编辑器',
  },

  /* ------------------------------------------------------------ 家宽库存 */

  homeinventory: {
    title: '家宽库存',
    count: (n: number) => `${n} 条线路`,
    empty: '库存是空的，没有线路可以分给客户',
    register: '登记一条',
    importLines: '批量导入',
    columns: {
      line: '线路',
      address: '地址',
      status: '状态',
      probe: '探测',
      bound: '绑了几个客户',
      action: '',
    } as const,
    status: {
      active: '在用',
      disabled: '停用',
      retired: '已退',
    } as const,
    kind: {
      catalog: '目录里的节点',
      socks5: 'SOCKS5 家宽',
    } as const,
    probeAlive: (alive: number, total: number) => `${alive}/${total} 通`,
    boundUnit: (n: number) => `${n} 人`,
    idle: '闲着',
    enable: '启用',
    disable: '停用',
    remove: '删除',
    removeTitle: '把这条线路从库存里删掉？',
    removeBody: (name: string) => `「${name}」会从库存里消失，以后不能再分给客户。已经记下的探测和账单不动。这一步删不掉还绑着客户的线路。`,
    boundBlocks: (n: number) => `还有 ${n} 个客户绑着这条线路，先去客户那儿解开`,
    registerTitle: '登记一条家宽',
    registerLead: '登记进来的线路默认就是在用，能直接分给客户。',
    fields: {
      displayName: '名字',
      proxyName: '线路代号',
      kind: '类型',
      socks5Host: '主机',
      socks5Port: '端口',
      socks5Username: '用户名',
      socks5Password: '口令',
      egressIpv4: '出口地址',
      notes: '备注',
    } as const,
    hints: {
      proxyName: '线路在配置里的那个名字，建好就别改了。',
      socks5Port: '填 1 到 65535 之间的数。',
      socks5Password: '口令只往上送。存进去之后这边再也读不回来，要换就重填一次。',
      egressIpv4: '不填也行，探测通了会自己认出来。',
    } as const,
    add: '加上',
    importTitle: '批量导入家宽',
    importLead: '一行一条：host:port:user:pass。写成 user:pass@host:port 或者 socks5:// 开头的地址也认。一次最多 50 行。',
    importLabel: '家宽线路，一行一条',
    importAction: '加入库存',
    importEmpty: '先贴几行进来',
    importAdded: (n: number) => `加了 ${n} 条`,
    importSkipped: (n: number) => `跳过 ${n} 条`,
    importFailed: (n: number) => `没加上 ${n} 条`,
    importNothing: '一条都没加上',
    importAgain: '已经在库存里了',
  },
} as const;
