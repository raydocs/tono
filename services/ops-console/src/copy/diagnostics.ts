// 失败聚类和单个客户的自动诊断（pages/diagnostics）。
export const diagnosticsCopy = {
  diagnosticsPanel: {
    clustersTitle: '失败聚类',
    clustersNone: '这段时间没有打开的失败聚类。',
    clustersLoading: '正在读取失败聚类…',
    clustersUnavailable: '失败聚类还读不到。控制面的聚类接口部署之后，这里会列出同一类失败。',
    clusterReach: (users: number, devices: number) => `${users} 人 / ${devices} 台`,
    sessionsTitle: '自动诊断',
    sessionsLoading: '正在读取自动诊断…',
    sessionsUnavailable: '这份自动诊断还读不到。控制面接口部署之后，这里会显示会话、链路和 DNS。',
    sessionsNone: '还没有自动诊断会话。',
    sessionNoNode: '未选节点',
    sessionRunning: '进行中',
    sessionDown: (bytes: number) => ` · 下行 ${bytes}`,
    sessionUp: (bytes: number) => ` · 上行 ${bytes}`,
    dnsLeft: '有一次 DNS 检查没有留在隧道里。',
    hopDown: '有一跳没有连上。',
  },
} as const;
