// 客户端: the adoption matrix, the release tables, and the three writes.
export const clientCopy = {
  adoptionCount: {
    current: (n: number) => `${n} 位在最新版`,
    behind: (n: number) => `${n} 位落后`,
    unreported: (n: number) => `${n} 位未上报`,
  },
  clientSections: {
    adoption: '版本分布',
    releases: '发布',
  } as const,
  /** The four version bands. `未上报` is silence, not a version. */
  bucket: {
    current: '最新',
    behind_one: '落后一版',
    behind_more: '落后两版以上',
    unreported: '未上报',
  } as const,
  bucketCell: (users: number, devices: number) => `${users} 位客户 · ${devices} 台设备`,
  releaseColumns: {
    channel: '渠道',
    version: '版本',
    published: '发布时间',
    minSupported: '最低支持版本',
    notes: '说明',
    action: '动作',
  } as const,
  channel: {
    stable: '正式',
    candidate: '候选',
    internal: '内部',
  } as const,
  releaseState: {
    /** Built, not shipped. Deliberately not 未发布, which the matrix uses for a
        platform that has never had a client at all. */
    draft: '待发布',
    withdrawn: '已撤回',
  } as const,
  releaseActions: {
    publish: '发布',
    withdraw: '撤回',
    setMin: '设最低支持版本',
  } as const,
  /** Every confirm repeats the consequence; none of them says "are you sure". */
  releaseConfirm: {
    publish: (platform: string, version: string) =>
      `这只在后台登记 ${platform} ${version} 为已发布，用于采用率与"版本过旧"待办；客户端的更新源（appcast / latest.json）仍由发版流程单独发布，登记不会推送更新。`,
    withdraw: (version: string) =>
      `这只在后台把 ${version} 标记为已撤回；要停止分发还得在发版流程里撤掉更新源。已安装的客户端不受影响。`,
    setMin: (version: string) =>
      `低于 ${version} 的客户端会被列进"版本过旧"待办，不会被停用。`,
    minPrompt: '最低支持版本',
    cancel: '取消',
  } as const,
  noReleases: '这个平台还没有发布记录',
  noClientsYet: '还没有发布过客户端',
  emptyAdoption: '还没有版本上报',
  clientsUnreleasedTitle: (platform: string) => `${platform} 还没有发布过客户端`,
} as const;
