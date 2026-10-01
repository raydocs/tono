/** The words a panel and its charts say about themselves, whatever page they sit on. */
export const panelCopy = {
  panelLoading: '正在读取',
  panelError: '这块没有读到，其他部分不受影响',
  panelRetry: '重试',
  panelEmpty: '这段时间没有记录',
  panelSource: (source: string) => `来源 ${source}`,
  panelAsOf: (ago: string) => `更新于 ${ago}`,
  panelStale: '已超过刷新周期，可能不是最新',
  chartNoData: '测到的点不足两个，画不出趋势',
  chartKeys: '左右方向键逐列查看，Shift 加方向键跳十列，Home、End 到两端，Esc 收起',
  chartLegend: '图例',
  chartReadout: (heading: string, rows: ReadonlyArray<{ name: string; value: string }>) =>
    `${heading}：${rows.map((row) => `${row.name} ${row.value}`).join('，')}`,
  probeWord: { alive: '通', dead: '不通', gap: '未测' },
  probeSummary: (total: number, alive: number, dead: number, gap: number) =>
    `探测 ${total} 次：通 ${alive}，不通 ${dead}，未测 ${gap}`,
} as const;
