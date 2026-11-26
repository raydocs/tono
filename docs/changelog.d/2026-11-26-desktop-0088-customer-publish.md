## 2026-11-26 · 桌面 0.0.88（macOS build 89）全量发布

- 归属：客户发布（用户在对话中明确指示「对外发布」）。
- 不可变源码提交：`ced5c8abe66cde7aae3466b84175c36e9600d7d4`（PR #1868、#1869，`release/macos` 与 `release/windows` 同源，`update_release_sequence = 8801`，Helper 协议 `4.52.78`）。
- 内容：修复 macOS 节点切换失败整条断开与原位回滚、补充 `utun` 与本地 DNS 就绪校验、在 TUN 失败诊断期间绕过延迟门控、Strict 模式连接期间禁止在线切换或重载、升级 Helper 至 `4.52.78` 并加固启动中断回滚/PF 探针/独立更新退出栅栏/IPC 空响应重试、持续打磨 Tahoe 液态玻璃界面与无障碍回退；Windows 端桌面版本号对齐 `0.0.88`。

### 构建与签名流水线
- `macos-release.yml`：https://github.com/raydocs/tono/actions/runs/45778194959 （success）；`Tono-0.0.88-build89-arm64.zip` sha256 `a55bb9518ce8b112c8b3ccf8c842d32ae1061f9e86d0692beacdcf4354f31925`
- `windows-release.yml`：https://github.com/raydocs/tono/actions/runs/45778199087 （success）；`Tono_0.0.88_x64-setup.exe` sha256 `f637aeaa39677ad7565c233d6a05429331c1bb55f261c63d828da34b1830c892`
- `macos-dmg.yml`：https://github.com/raydocs/tono/actions/runs/45784605298 （success）；`Tono-0.0.88-build89-arm64.dmg` sha256 `111c28db148c0641c1aa99baa65fcfa7d528d769addac1c50995cd4d7fdfed85`
- `desktop-update-sign.yml`：https://github.com/raydocs/tono/actions/runs/45784609812 （success，从 `release/windows` 触发）；清单 `desktop/v1/f0de8b086102db7af76be61bc1ae04c6fe8fd8ba02decb5579eec935e5178fb3/manifest.json`
- `windows-update-promote.yml`：https://github.com/raydocs/tono/actions/runs/45784614875 。`windows-update-channel` 由 agent 按决策 023 批准（commit `ced5c8abe66cde7aae3466b84175c36e9600d7d4`，sequence `8801`），`windows-updates` 推进到 `6acc9e7d4d8575650d6bd29d50b7e3e58fdeda6d`。末步「Follow the channel on the download page」因 `main` 分支保护规则禁止直推而失败，与 0.0.85/0.0.86 相同，由本 PR 手工提交 `latest.json` 与下载页。

### 分发入口
- GitHub Releases：`tono-macos-0.0.88-build89`（zip + dmg）、`v0.0.88`（非草稿）。
- R2 `tono-releases`：已上传并逐个校验字节一致的 `.exe`、`.zip`、`.dmg` 与 `desktop/v1/f0de8b086102db7af76be61bc1ae04c6fe8fd8ba02decb5579eec935e5178fb3/*` 5 个不可变对象，随后推进 `desktop/v1/latest/manifest.json`。
- 传统更新源与下载页：`appcast.xml`（build 89 / 0.0.88）、`windows/latest.json`（0.0.88）、`releases/{index.html,manifest.json}`，`RELEASE_ASSET_REVISION` → `site-public-pages-20261126`。
- 未运行：真机升级验证。
