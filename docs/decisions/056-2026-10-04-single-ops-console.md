## 2026-10-04 · ops1 和 ops2 只保留哪一套
- Status: provisional
- Chosen: 接续所有者“升级，然后 ops1 和 2 就留一个”的明确指令，仅保留 services/ops-console（现 ops2）作为 UI 实现；canonical 暂留 /ops2/，旧 /、/ops/ 只兼容重定向和 hash 迁移。替代决定 055 对本批保留旧 UI 的选择，不另建 ops3。迁入旧流量页能力后删除旧 React 入口/页面/组件/样式及专用构建；共享 lib/API 类型、已有 helper 测试和 legacy handlers 保留。
- Why stricter: 两套 UI 不再各自构建或写入；同源写保护和角色门不变，/ops2/ 资产也进入既有 Worker Access admin 校验。不改数据、API 合同、计量、采集器、告警或特权数据面；不能等价迁移的旧筛选明确提示，不伪装已应用。未证明真实事故/告警退役门禁，不以此决定授权未审查的生产切换。
- Applied in: [#1377](https://github.com/raydocs/tono/pull/1377) draft，raydocs/seadevil；[实现与验收记录](../ops/console-consolidation-2026-10-04.md)。未合并、未部署。
