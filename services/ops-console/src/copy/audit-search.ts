export const auditSearchCopy = {
  filters: '筛选记录',
  target: '对象 ID（精确匹配）',
  actor: '操作人邮箱（精确匹配）',
  before: '早于此时间（本地时区）',
  action: '动作包含（仅已加载记录）',
  apply: '查询',
  retry: '重新读取',
  open: '查看对象',
  invalidTime: '请填写有效的截止时间。',
  scope: (loaded: number, shown: number, more: boolean) => `已加载 ${loaded} 条，当前匹配 ${shown} 条。动作只筛已加载记录，不代表全库结果；${more ? '可继续加载' : '当前查询已到末尾'}。`,
  noMatches: '已加载记录中没有匹配的动作。',
  beforeActive: (time: string) => `早于 ${time}`,
} as const;
