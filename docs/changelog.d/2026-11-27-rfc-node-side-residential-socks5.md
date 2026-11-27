## 2026-11-27 · 住宅 SOCKS5 节点侧拨号（`u:` / `h:` 双身份下沉）RFC 提案

- 归属：住宅家宽运维与架构规划（[ops/plan-2026-09-11.md](../ops/plan-2026-09-11.md)）；分支 `docs/rfc-node-side-residential-socks5`。
- 来源：`origin/main` → 本分支。
- 缺陷修复：无（纯架构设计 RFC，不含运行时/worker/D1 改动）。
- 新增/优化：
  1. 在 [docs/proposals/node-side-residential-socks5.md](../proposals/node-side-residential-socks5.md) 与 [docs/README.md](../README.md) 落地完整技术提案，定义云端 `u:` 与家宽 `h:` 双身份命名空间、独立顶层 `homeIdentities` / `homeOutbounds` 下发边界、`freedom` 默认保留与 `h:` 显式字面量 CIDR 隔离及全量替换规则、`device_home_credentials` 与 `rmo` 排空超时 fail-closed 状态机、字节级 `routingSha256` v2 跨端共享测试向量，以及覆盖 `Tono` / `tono-core` / `TonoKit` / Android `routing` 的 PR 0–PR 5 分阶段路线。
- 验证：`git diff --check` 与 `node tooling/scripts/records.mjs changelog --since 2026-11-27` 通过。
- 候选/发布：仅文档 Draft PR（[#1873](https://github.com/raydocs/tono/pull/1873)），不触发实施或发布。
- 剩余限制：PR 1 实施前需在非生产环境的 Xray `26.3.27` 与 `v26.11.9` 上完成 PR 0 实机探针验证。
