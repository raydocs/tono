## 2026-11-25 · 桌面 0.0.85（macOS build 86）全量发布

- 归属：客户发布（由用户在对话中明确授权「全量」推送所有发布渠道）。
- 不可变源码提交：`1686de5e5e94471aca00fa604d5f79200e026c3e`（PR #1853，`release/macos` 与 `release/windows` 同源，`update_release_sequence = 8501`）。

### 构建与签名流水线
- `macos-release.yml`：https://github.com/raydocs/tono/actions/runs/45537034004 （8/8 jobs `success`）
  - 产物：`Tono-0.0.85-build86-arm64.zip`（19,107,498 bytes，sha256 `a15c1a56bdfc8875d934698fc437113b69aaf63e6268fc15815fb7c8fcb8ea46`）
- `windows-release.yml`：https://github.com/raydocs/tono/actions/runs/45537036761 （10/10 jobs `success`）
  - 产物：`Tono_0.0.85_x64-setup.exe`（40,707,247 bytes，sha256 `a8c411533fb59525db56363fbd71c90bc9a790fd635ef0120bdf780b0c2a7a41`）
- `macos-dmg.yml`：https://github.com/raydocs/tono/actions/runs/45546958836 （`success`，已公证并 stapler 校验通过）
  - 产物：`Tono-0.0.85-build86-arm64.dmg`（21,392,853 bytes，sha256 `99daa11ba05692b4e4a430218e204f993f82e0c63c38e4f3e42a79da90cddc3e`）
- `desktop-update-sign.yml`：https://github.com/raydocs/tono/actions/runs/45546962528 （8/8 jobs `success`）
  - 签名清单：`desktop/v1/f0a277c50ae1aec50cceaf084a67b54e5a06ffd6f1b8af3337be8355c83780f2/manifest.json`（`tono-0.0.85-s8501-1686de5e`）
- `windows-update-promote.yml`：https://github.com/raydocs/tono/actions/runs/45547131600
  - 环境审批：`windows-update-channel` 由 agent 按决策 023 批准（commit `1686de5e5e94471aca00fa604d5f79200e026c3e`，sequence `8501`）；`Require a published stable Windows Release`、`Verify every channel artifact with the configured updater public key` 与 `Atomically advance the audited Windows channel branch` 均通过，`origin/windows-updates` 已推进至 `0.0.85`（受 `main` 仓库规则集保护，`public/` 镜像与发布中心更新由本 PR 合入 `main`）。

### 分发入口与更新通道
- GitHub Releases：
  - macOS：https://github.com/raydocs/tono/releases/tag/tono-macos-0.0.85-build86 （含 `.zip` 与 `.dmg`）
  - Windows：https://github.com/raydocs/tono/releases/tag/v0.0.85 （`draft=false`, `prerelease=false`）
- R2 下载桶（`tono-releases` → `https://releases.afk.ccwu.cc/download/`）：已上传并验证 `.exe`、`.zip`、`.dmg` 与 `desktop/v1/<sha256>/*` 全部 5 个不可变对象，随后推进 `desktop/v1/latest/manifest.json`。
- 传统更新源与下载首页：更新 `services/control-plane/public/appcast.xml`（build 86 / `0.0.85`）、`services/control-plane/public/windows/latest.json`（`0.0.85`）、重建 `services/control-plane/public/releases/{index.html,manifest.json}` 并推进 `RELEASE_ASSET_REVISION` 至 `site-public-pages-20261125`。
