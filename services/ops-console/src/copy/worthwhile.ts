// 本周最值得做的三件事: the last block of the 早报.
//
// The rest of the morning read says what happened. This says what to do about
// it, and never more than three things — a fourth line is a list, and a list is
// not a plan.
//
// Every line here is a sentence, not a label with a number stuck on the end:
// the hub sends a kind, a name and a measurement, and the words that turn them
// into something an operator can read live only in this file.
export const worthwhileCopy = {
  worthwhileTitle: '本周最值得做的三件事',
  /** A quiet week is an answer. Three empty rows are not. */
  worthwhileNone: '本周没有特别值得做的事',
  worthwhileGo: '去处理',
  /** Some things have to be done and pay nothing; saying so beats a fake number. */
  worthwhileNoPayoff: '无法估算',
  /** An estimated yuan and a measured one must never read alike. */
  worthwhileAbout: (amount: string) => `≈${amount} 估算`,
  /** How much of the number to believe. */
  worthwhileSure: {
    high: '有把握',
    medium: '差不多',
    low: '不太准',
  } as const,
  /**
   * One sentence per kind, given the name of the thing and the fact behind it.
   * The pair is always (谁, 多少) so a kind that grows a second number later
   * does not change the shape of every other line.
   */
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
  /** The unit a measurement is read in. */
  worthwhileUnit: {
    days: (value: string) => `${value} 天`,
    incidents: (value: string) => `${value} 次`,
    customers: (value: string) => `${value} 位客户`,
    hours: (value: string) => `${value} 小时`,
  } as const,
} as const;
