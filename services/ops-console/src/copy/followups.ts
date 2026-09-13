// 跟进记录，和从证据拼出来的那封回信。
export const followupCopy = {
  /**
   * 跟进 is the service record: what was said to the customer, what is being
   * waited on, and when somebody promised to come back. It is not a health
   * word and not an incident — nothing here is broken, it is only owed.
   */
  followupSection: '跟进',
  followupKind: {
    reply: '已回复',
    await_customer: '等客户验证',
    callback: '约定回访',
    verified: '已确认恢复',
    note: '备注',
  } as const,
  followupKindLabel: '这一条算什么',
  followupBodyLabel: '写这次跟进',
  followupDueLabel: '什么时候回来看',
  followupAdd: '记一条',
  followupDone: '办结',
  followupDoneAt: (when: string) => `已办结 ${when}`,
  followupDueAt: (when: string) => `${when} 回访`,
  followupBy: (who: string) => `${who} 记的`,
  followupNone: '还没有跟进记录',
  followupNeedBody: '先写一句这次跟进说了什么',
  /** The two header actions that write their own record. */
  followupAuto: {
    diagnose: '已远程诊断',
    resend: '已重发凭证',
  } as const,

  /* ------------------------------------------------------------ 客服草稿 */

  /**
   * The draft is assembled from fields, one line each, and nothing else.
   *
   * Every sentence below names the measurement it came from — the attempt, the
   * stage, the code, the public incident, the spare node the engine still
   * calls healthy. Nothing may guess at a cause: an operator who pastes "被墙了"
   * into a reply has told the customer something no field on this page says.
   */
  replyDraft: '回复草稿',
  replyDraftOpen: '写一封回信',
  replyDraftNone: '这位客户最近没有失败的连接记录，草稿没有可引用的证据',
  replyDraftHint: '每一句都来自这一页上的字段；发出去之前请自己改一遍。',
  replyCopy: '复制',
  replyCopied: '已复制',
  replyLine: {
    greeting: (who: string) => `${who} 您好，`,
    attempt: (when: string, node: string) => `我们看到最近一次连接尝试是在 ${when}，走的是 ${node}。`,
    attemptNoNode: (when: string) => `我们看到最近一次连接尝试是在 ${when}。`,
    stage: (stage: string, why: string) => `失败发生在${stage}这一步，客户端报回来的原因是：${why}。`,
    stageCode: (stage: string, code: string, why: string) =>
      `失败发生在${stage}这一步，客户端报回来的是 ${code}，也就是${why}。`,
    incidentYes: (title: string) => `这台机器现在有一条已登记的事故：${title}。`,
    incidentNo: '这台机器现在没有已登记的事故，问题可能只在您这条线路上。',
    alternative: (node: string) => `建议先在客户端里换到 ${node}，引擎现在对它的判断是正常。`,
    alternativeNone: '现在没有判定正常的替代节点可以推荐，我们会先处理这台机器。',
    question: (question: string) => `想请您确认一件事：${question}`,
  },
  replyQuestion: {
    CATALOG_STALE: '在客户端里刷新一次节点列表之后，还连不连得上？',
    TLS_HANDSHAKE_TIMEOUT: '换到上面这个节点之后，是不是还卡在同一个地方？',
    REALITY_AUTH_FAIL: '这台设备最近有没有重装过客户端或者换过登录邮箱？',
    DNS_FAIL: '换一个网络（比如手机热点）之后还连不连得上？',
    other: '换到上面这个节点之后，还连不连得上？',
  } as const,
} as const;
