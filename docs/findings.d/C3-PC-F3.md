| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| C3-PC-F3 | `PUT exit-catalog` 只逐条查字段，不做两端客户端都会做的集合级准入：节点重名、保留名（如 `DIRECT`、`REJECT`、`GLOBAL`）与 macOS 拒收的名称前缀；这样的目录两端整份拒收，发布却返回 200 | in-PR | [#1713](https://github.com/raydocs/tono/pull/1713)（Draft 修复）；原 [#1415](https://github.com/raydocs/tono/pull/1415) 评审 `3af4d950` opus:F1 | 低·已确认 | Draft 源码修复：完整名称判重、两端保留名并集与 macOS 前缀校验；同节点 VLESS + hy2 可发布。旧源码实际 RED、修复后窄测试 55 / 全量 1052 通过；仅源码，独立审查/hosted CI/真实目录与设备验证未完成；C3-PC-F4 另做 |

2026-10-22 续修（ops plan §7.2）：旧主线 `d1232520a` 上发布重复名称实际得到 200（新回归要求 400），三个集合级单测也实际失败。
实现对照 macOS `ConfigPipeline.validatedOwnedNodes` 与 Windows `validate_node_set`；保留完整 proxy 名，不折叠 hy2 后缀。
既有发布正对照及 roster 夹具中的保留名同步改为非保留名，不放宽断言、Tono 身份过滤或证书检查。详见 [本次更新记录](../changelog.d/2026-10-22-catalog-name-set-admission.md)。
