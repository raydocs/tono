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
    verified: '校验',
    minSupported: '最低支持版本',
    notes: '说明',
    action: '动作',
  } as const,
  /**
   * What the 校验 column says about one build. 已校验 carries the first eight
   * characters of the digest and the size, because those are what an operator
   * compares against the build they just uploaded; the other two are states, not
   * missing measurements, so they are words rather than an em dash.
   */
  releaseVerified: {
    checked: (digest: string, size: string) => `已校验 · ${digest} · ${size}`,
    unverified: '未校验',
    unsigned: '未签名',
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
      `${platform} 的客户端下次检查更新时就会看到 ${version}，并开始自动升级到它。已经装好的旧版本不会被卸载。`,
    withdraw: (version: string) =>
      `${version} 会从客户端检查更新的地方消失，上一个已发布的版本重新变成最新版。已经升到 ${version} 的客户端不会被退回去。`,
    setMin: (version: string) =>
      `低于 ${version} 的客户端会被列进"版本过旧"待办，不会被停用。`,
    minPrompt: '最低支持版本',
    cancel: '取消',
  } as const,
  /**
   * Why a 发布 button cannot be pressed, in the words the operator needs to fix
   * it. A greyed button with no reason is what makes people reload the page.
   */
  publishBlocked: {
    unwired: (platform: string) => `${platform} 还没有自动更新，发布了客户端也收不到`,
    unverified: '还没跟更新源上的文件核对过，先重新登记这个版本',
    unsigned: '这个包没有签名，客户端会拒绝安装',
  } as const,
  /** Appended to a platform's heading when its clients cannot auto-update. */
  releaseUnwiredHint: '客户端还不会自动更新',
  noReleases: '这个平台还没有发布记录',
  noClientsYet: '还没有发布过客户端',
  emptyAdoption: '还没有版本上报',
  clientsUnreleasedTitle: (platform: string) => `${platform} 还没有发布过客户端`,
} as const;
