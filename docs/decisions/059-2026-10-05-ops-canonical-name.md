## 2026-10-05 · 唯一运维后台统一叫 ops
- Status: provisional
- Chosen: 按所有者“就改名叫 ops，别叫 2”统一正式入口为 `/ops/`；`/ops2/` 保留相对 302 兼容入口，不留第二份静态包。
- Why stricter: Worker Access admin 与 UI CSP 不变；旧专属 hash、旧根和旧路径书签仍迁移。未标记的 `#/nodes` 优先新版节点页，不再按旧别名解释成目录；显式 `legacy=ops1`、旧根/路径入口仍保留旧别名语义。这一相同 URL 的历史歧义无法同时表示两页，不添加隐式绕过或另一个 UI。
- Applied in: `ops/canonical-name-20261005`；运维计划 §6，交付/部署收据见 [命名记录](../changelog.d/2026-10-05-ops-canonical-name.md)。不改邮件规则、Telegram、密钥、生产数据或客户发布。
