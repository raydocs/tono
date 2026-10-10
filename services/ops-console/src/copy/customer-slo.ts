// 客户 360「这月实际体验」：按这位客户当前的节点与运营商，读近 30 天的每日 SLO。
export const customerSloCopy = {
  customerSlo: {
    title: '这月实际体验',
    range: '近 30 天',
    scope: (node: string, carrier: string | null) =>
      carrier === null ? `${node} · 所有运营商` : `${node} · ${carrier}`,
    noNode: '还不知道这位客户在用哪个节点，没有可对照的体验数据',
    none: '这个节点和运营商近 30 天没有连接记录',
    successRate: '成功率',
    p50: '连上用时中位数',
    outage: '已验证中断',
    unmeasured: '缺测',
    carrier: {
      mobile: '移动',
      telecom: '电信',
      unicom: '联通',
      other: '其他运营商',
    } as const,
    /** 运营商文字里的中文字样，与 slo-rollup.ts 归类用的一致。 */
    carrierMatch: {
      mobile: '移动',
      telecom: '电信',
      unicom: '联通',
    } as const,
  },
} as const;
