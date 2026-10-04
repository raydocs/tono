## 2026-10-04 · 后台改进采用业务导航还是另建一套控制台

- Status: provisional
- Chosen: 继续改进 ops2，按工作台、客户与接入、节点与线路、财务经营、系统管理组织现有入口；保留 ops1 和所有原深链。先把已有能力直接暴露出来，不另建 ops3，不在旧后台新增写入口，不同时改 API、身份和权限。
- Why stricter: 页面归组不授予新权限，仍使用原页面的角色门及 Worker 鉴权；操作确认、事实来源、未知结果和原 API 不变。旧入口退役须另行核验运维计划 §6 的证据。
- Applied in: [#1377](https://github.com/raydocs/tono/pull/1377)（实现 `a4f9a818`，`raydocs/seadevil`）；[对照和后续路线](../ops/console-improvement-2026-10-04.md)。仅源码和夹具验收，未部署。
