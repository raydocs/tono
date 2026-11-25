## 2026-11-25 · 桌面 0.0.86（macOS build 87）全量发布

- 归属：客户发布（用户在对话中明确选择「全量发布」）。
- 不可变源码提交：`036db12598343dfff13da8a2fda721a38b055996`（PR #1857，`release/macos` 与 `release/windows` 同源，`update_release_sequence = 8601`）。
- 内容：客户端支持签名策略 `tcpDirectAddresses` / v5 `tcpEndpoints`（#1856）。生产 traffic-policy rev 11（18 个国金 QMT IPv4）已于同日发布，Control Plane `main@184101b0c` 已部署。

### 构建与签名流水线
- `macos-release.yml`：https://github.com/raydocs/tono/actions/runs/45610516558 （success）；`Tono-0.0.86-build87-arm64.zip` sha256 `56a3d83ef01b7cbbc1d4017e9eb0268c16e8b84e1d28644ea0e6f70f7d7df77b`
- `windows-release.yml`：https://github.com/raydocs/tono/actions/runs/45610522549 （success）；`Tono_0.0.86_x64-setup.exe` sha256 `8316d5e39365e488f919cee06ab0efdcb914753471c16d6e501838581bbbb8b1`
- `macos-dmg.yml`：https://github.com/raydocs/tono/actions/runs/45616394535 （success）；`Tono-0.0.86-build87-arm64.dmg` sha256 `e975d85cf2f068ef409cea837f0b2c85548504deb9e563b88710f5673c44524c`
- `desktop-update-sign.yml`：https://github.com/raydocs/tono/actions/runs/45616801019 （success，须从 `release/windows` 触发；首次从 `release/macos` 触发被分支守卫拒绝）；清单 `desktop/v1/2e86e111766f37663b2e7e2c2a2f016a9e01528b945332e2df8296ca0a1054f8/manifest.json`
- `windows-update-promote.yml`：https://github.com/raydocs/tono/actions/runs/45616996279 。第一次（45616420700）因 R2 尚无 `.exe` 在校验步失败；上传后重跑，`windows-update-channel` 由 agent 按决策 023 批准（commit `036db1259`，sequence `8601`），`windows-updates` 推进到 `d6ae9c300`。末步「Follow the channel on the download page」无法直接推 main，与 0.0.85 相同，由本 PR 手工提交 `latest.json` 与下载页。

### 分发入口
- GitHub Releases：`tono-macos-0.0.86-build87`（zip + dmg）、`v0.0.86`（非草稿）。
- R2 `tono-releases`：已上传并逐个校验字节一致的 `.exe`、`.zip`、`.dmg` 与 `desktop/v1/<sha256>/*` 5 个不可变对象，随后推进 `desktop/v1/latest/manifest.json`。
- 传统更新源与下载页：`appcast.xml`（build 87 / 0.0.86）、`windows/latest.json`（0.0.86）、`releases/{index.html,manifest.json}`，`RELEASE_ASSET_REVISION` → `site-public-pages-20261125b`。
- 未运行：真机升级验证（见下一步）。
