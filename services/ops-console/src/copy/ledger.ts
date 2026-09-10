/**
 * Every word 账目 says.
 *
 * This is the one page in the console that is about money the operator has
 * actually taken or paid, so two habits from the rest of the vocabulary get
 * stricter here. A margin nobody can compute says 待核对 and never a number —
 * a customer sitting on a machine whose meter is not agreed is a customer
 * whose cost is a guess, and a guessed margin is the one number on this page
 * that would be believed. And every converted amount carries the day and the
 * rate it was converted at, because "≈ ¥908" with nothing behind it is a
 * figure the operator cannot check against a bank statement.
 *
 * The words for the four kinds are the ones written on a receipt — 收入, 退款,
 * 补偿, 支出 — rather than a sign convention: an operator reconciling a month
 * reads the word, not the minus.
 */
export const ledgerCopy = {
  ledger: {
    /** What every number on this page was read off. */
    source: '账目',

    /* ------------------------------------------------------------- 本月一页 */

    monthField: '月份',
    monthName: (year: string, month: string) => `${year} 年 ${month} 月`,
    revenue: '收入',
    cost: '支出',
    margin: '毛利',
    /** The word that stands in for a margin nobody can compute yet. */
    pending: '待核对',
    pendingCount: (n: number) => `${n} 项还没对上`,
    pendingNone: '这个月都对上了',
    pendingLead: '这些客户和机器的成本还没对上，他们的毛利这个月先不算。',
    pendingCustomers: '客户',
    pendingNodes: '机器',
    byCategory: '按类目',
    categoryColumn: '类目',
    amountColumn: '金额',
    noCategories: '这个月还没记过账',

    /* --------------------------------------------------------------- 锁定 */

    closed: '已锁定',
    closedBy: (who: string, when: string) => `已锁定 · ${who} · ${when}`,
    closeAction: '锁定本月',
    closeTitle: '锁定本月',
    closeBody: (month: string, revenue: string, cost: string, margin: string, pending: string) =>
      `锁定 ${month} 之后这个月只能冲正，不能改。收入 ${revenue}，支出 ${cost}，毛利 ${margin}，${pending}。`,
    /**
     * Locking the month you are standing in is not the same promise.
     *
     * A reversal is written into the month it is made in, so "只能冲正" is true
     * of a past month and false of this one: lock this one and the reversal has
     * nowhere to land either.
     */
    closeBodyCurrent: (month: string, revenue: string, cost: string, margin: string, pending: string) =>
      `锁定 ${month} 之后这个月就改不了了；冲正也落在这个月（按后台的月份算），锁上之后连冲正都得等下个月。`
      + `收入 ${revenue}，支出 ${cost}，毛利 ${margin}，${pending}。`,
    closeConfirm: '锁定',
    closedAlready: '这个月已经锁了',
    lockedNote: '这个月已经锁了，只能冲正，不能改。',
    lockedNoteCurrent: '这个月已经锁了，改不了；冲正也落在这个月，得等下个月再冲。',
    exportAction: '导出 CSV',

    /* ------------------------------------------------------------- 录入抽屉 */

    newEntry: '记一笔',
    entryTitle: '记一笔',
    fieldKind: '类型',
    fieldCategory: '类目',
    fieldSubject: '对象',
    fieldAmount: '金额',
    fieldCurrency: '币种',
    fieldMonth: '归到哪个月',
    fieldPaidAt: '付款日',
    fieldNote: '备注',
    subjectHint: {
      user: '这笔算在谁头上。',
      node: '哪台机器。',
      home_exit: '哪条家宽线路。',
      account: '哪个号。',
      fleet: '整个机队的开销，不落到某一个客户或机器上。',
    } as const,
    subjectFleet: '机队',
    subjectNone: '还没得选',
    subjectPick: '先选一个',
    amountHint: '原币金额，小数点后两位。',
    amountInvalid: '金额得是个数',
    /**
     * The one line under a locked 币种, and the one a refused entry gets back.
     * Money coming in is only ever taken in yuan, so the field says so rather
     * than offering five currencies the hub will turn down.
     */
    currencyCny: '收款只收人民币',
    monthHint: '这笔算在哪个月的账上，跟付钱那天可以不是同一个月。',
    paidHint: '真正付钱或收钱的那一天，汇率按这一天取。',

    /* ----------------------------------------------------------------- 汇率 */

    fxLine: (day: string, rate: string, cny: string) => `按 ${day} 汇率 ${rate} ≈ ${cny}`,
    fxStale: (asked: string, used: string) => `${asked} 的汇率还没拉到，用的是 ${used} 的。`,
    fxLoading: '正在取汇率',
    fxMissing: (day: string) => `${day} 的汇率还没拉到，等今天的汇率进来再记，或者换一个付款日。`,
    fxNoNeed: '人民币不用换算。',

    /* ---------------------------------------------------------------- 条目表 */

    entries: '条目',
    entryCount: (n: number) => `${n} 笔`,
    empty: '这个月一笔账都没有',
    columns: {
      day: '日期',
      kind: '类型',
      category: '类目',
      subject: '对象',
      amount: '原币金额',
      cny: '折人民币',
      note: '备注',
      action: '',
    } as const,
    kind: {
      revenue: '收入',
      refund: '退款',
      credit: '补偿',
      cost: '支出',
    } as const,
    category: {
      plan: '套餐',
      server: '服务器',
      home_line: '家宽',
      domain: '域名',
      control_plane: '控制面',
      claude_account: 'Claude 账号',
      chatgpt_account: 'ChatGPT 账号',
      other: '其他',
    } as const,
    editNote: '改备注',
    editNoteTitle: '改备注',
    editNoteBody: '备注是这一笔还能改的唯一一样东西；金额、对象或者类目记错了，得冲正重记。',
    reverse: '冲正',
    reverseTitle: '冲正这一笔',
    /**
     * Which month the new entry lands in, and whose month that is.
     *
     * The console reads 本月 off the operator's own clock; the 后台 reads it off
     * UTC, so on the first and the last day of a month the two can disagree by
     * one. The sentence says whose answer wins rather than pretending they
     * always match.
     */
    reverseBody: (what: string, month: string) =>
      `冲正会在 ${month}（按后台的月份算）记一笔跟「${what}」相反的账，原来那笔留着，标成已冲正。`,
    reverseConfirm: '冲正',
    /** Why 冲正 is greyed out: the month it would land in is locked. */
    reverseLocked: '本月（按后台的月份算）已经锁了，冲正落不进来，得等下个月。',
    /** The same thing said by the 后台 after the month was locked mid-session. */
    reverseRefused: '冲正落在本月（按后台的月份算），那个月已经锁上了，这一笔没记成，等下个月再冲。',
    reversed: '已冲正',
    reversedBy: '看冲正那笔',
    reverses: '冲正的是这笔',

    /* --------------------------------------------------------- 客户与节点上的 */

    customerRevenue: '本期收入',
    customerCost: '分摊成本',
    customerMargin: '毛利',
    customerNone: '本月还没有账目',
    perGb: '每 GB 成本',
    /** The 改到期 drawer's one extra field: a renewal that was also paid for. */
    alsoLog: '顺手记一笔套餐收入',
    alsoLogHint: '到期日改好之后，在本月的账上给这个客户记一笔套餐收入。',
    alsoLogAlso: (money: string) => `顺手在本月记一笔 ${money} 的套餐收入。`,
    alsoLogFailed: (why: string) => `到期日改好了，但那笔收入没记上：${why}`,
  },
} as const;
