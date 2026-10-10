| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| UPDATE-V1-UNPUBLISHED-404 | v1 更新渠道尚未发布（发布主机对 `desktop/v1/latest/manifest.json` 回 404）时，两端原生更新器把它当检查失败：macOS 手动检查弹「Update not completed」，Windows 手动检查提示「Couldn't check for updates」且后台检查改为每小时重查 | in-PR | [#1521](https://github.com/raydocs/tono/pull/1521) | 低·已确认 | 修复后 404 只对发现对象视为「无更新」；已发布清单的签名或安装包 404 仍是错误；只读核对 2026-10-10，未发布任何内容 |

2026-10-10 只读核对（curl）：`releases.afk.ccwu.cc/desktop/v1/latest/manifest.json` 回 404，且带 `cache-control: no-store`，
只有 `services/control-plane/src/releases/host.ts` 中 latest 路由命中后 R2 对象缺失才会加这个头（同主机 `/desktop/v1/latest/other.json`
等未命中路由的 404 不带）；同一 R2 绑定的 `/download/Tono-0.0.67-build67-arm64.zip` HEAD 为 200。路径与布局在客户端
（`NativeUpdateDownload.origin`、`update_wire.rs` `DISCOVERY_URL`/`RELEASE_ROOT`）、Worker 路由与
`tooling/scripts/desktop-update-v1.mjs` `writeBundle`（`desktop/v1/<sha256>/…`、`desktop/v1/latest/manifest.json`）三处一致：
原因是 v1 渠道尚未发布（G4 前预期如此，客户发布由所有者把关），不是路径错配。旧渠道 `windows/latest.json`（0.0.34）与
`api.afk.ccwu.cc/appcast.xml`（0.0.67）均 200。
