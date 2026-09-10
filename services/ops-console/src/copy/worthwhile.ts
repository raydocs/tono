// 本周最值得做的三件事: the last block of the 早报.
export const worthwhileCopy = {
  worthwhileTitle: '本周最值得做的三件事',
  worthwhileNone: '本周没有特别值得做的事',
  worthwhileGo: '去处理',
  worthwhileNoPayoff: '无法估算',
  worthwhileAbout: (amount: string) => `≈${amount} 估算`,
  worthwhileSure: {
    high: '有把握',
    medium: '差不多',
    low: '不太准',
  } as const,
  worthwhileLine: {
    idle_node: (name: string, money: string) => `${name} 这个月一个客户都没带，每月还在付 ${money}`,
    quota_exhausting: (name: string, days: string) => `${name} 大约 ${days}后就把流量跑完`,
    node_renewal: (name: string, days: string) => `${name} 还有 ${days}到期，该续了`,
    line_renewal: (name: string, days: string) => `${name} 这条家宽还有 ${days}到期`,
    repeat_repair: (name: string, times: string) => `${name} 一个月里坏了 ${times}，值得查根因`,
    route_direct: (name: string, bytes: string) => `${name} 一个月绕出去 ${bytes}，可以放直连`,
    followup_overdue: (name: string, days: string) => `欠 ${name} 的那条跟进已经拖了 ${days}`,
    month_unclosed: (month: string, days: string) => `${month} 的账还没关，已经过去 ${days}`,
  } as const,
  worthwhileUnit: {
    days: (value: string) => `${value} 天`,
    incidents: (value: string) => `${value} 次`,
    customers: (value: string) => `${value} 位客户`,
    hours: (value: string) => `${value} 小时`,
  } as const,
} as const;
