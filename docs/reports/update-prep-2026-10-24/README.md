# 更新源准备 · 2026-10-24 · 不发布

这份目录是离线 dry-run。它不是客户更新，不能上传，不能拿去签名。
`services/control-plane/public/` 在这个分支里没有改动。线上 appcast 仍是
Sparkle build **67** / 短版本 **0.0.67**，Windows `latest.json` 仍是 **0.0.34**。

候选身份（源码标签，不是已构建的包）：

| 项 | 值 |
|---|---|
| app 版本 | 0.0.80（本树 `package.json` / `MARKETING_VERSION`） |
| Sparkle build | 81（高于线上 67） |
| 基线源码 | `322f48c6fcb13b26279fed22ae19f79dcc2522bb` |
| release id | `dry-run-2026-10-24-not-for-publish` |
| releaseSequence | `1`，只为了让 manifest 格式合法。**不是**装机水位。真发布由老板在签名时指定 `TONO_UPDATE_RELEASE_SEQUENCE` |
| 摘要 | 标签的 sha256，不是安装包 |
| 签名 | `UNSIGNED-DRY-RUN`。`validateEdSignature` 会拒绝它 |
| 地址 | `https://example.invalid/tono-dry-run/...` |

## 链路现状

原生客户端找的是 v1 manifest，不是下面两个旧文件。

- macOS：`NativeUpdateDownload.origin` 为 `https://releases.afk.ccwu.cc/desktop/v1/latest/manifest.json`。当前 App 里没有 Sparkle 安装器（`apps/macos/NATIVE_UPDATE_V1.md`）。Info.plist 仍留着旧的 `SUFeedURL` `https://api.afk.ccwu.cc/appcast.xml`。本 PR 不改这个地址。
- Windows：`apps/windows/service/src/update_wire.rs` 的 `DISCOVERY_URL` 是同一个 v1 manifest。`public/windows/latest.json` 仍是 Tauri 旧通道，SHIP_PLAN 把它和 appcast 一起当作客户指针。
- 404 表示没有更新（decision 087），不是失败。v1 目录还没发过已签名的 bundle 时，应用内检查就是「没有更新」。
- Android / iOS：本树的 Swift / Kotlin 里没有 appcast、`latest.json` 或 Play 应用内更新。手机不在这次范围内。

## 覆盖与缺口

**版本不回退**

- v1：`releaseSequence` 必须高于已消费高水位和装机 floor（`tooling/scripts/core-helper/UpdateTransaction.swift`）。漏掉 sequence 时准入直接拒绝，不会用版本号猜测（`docs/UPDATE_INTEGRATION_V1.md`）。
- Sparkle：比的是 `sparkle:version` 这个整数 build。
- Windows 旧通道：比 `latest.json` 的版本字符串。

**来源**

- v1 manifest 是 canonical JSON。macOS 用 Sparkle Ed25519 签这份 JSON，Windows 用现有 minisign。包和组件摘要绑在 manifest 上，Windows 还必须有 `singBoxSha256`。
- `verifyManifest` 要用编译进客户端的公钥。这次 dry-run **不调用**它，也没有私钥。
- 未签名的 CI 包过不了 helper 的信任边界。不能拿这份 manifest 去签。

**安装中断**

- macOS：`UpdateHandoffJournal` 留下未完成、失败或过期的记录。界面现在说「上一次更新没有完成。记录还留着」，并给出稍后再试或请家人帮忙。路径和 helper 原句只进日志。
- Windows：Service 说上一次更新还要对账时，检查更新不再说成「检查网络」。签名、水位、Service 明确拒绝会停住「现在更新」；网络失败仍可以再试。

**渠道**（`docs/RELEASE_LINES.md`）

- `release/macos`、`release/windows`：签名构建。环境 job 是 `macos-appcast`、`windows-release`、`windows-update-channel`。本 PR 不碰这些环境。
- `windows-updates`：机器生成的 `latest.json` 历史，不能拿来开发。
- `main`：线上 Worker 的源。客户文件在 `services/control-plane/public/`。
- 没有新通道。

**还缺什么**

- 真包、真签名、真安装都没有。G3 的装机成功和失败证据仍是老板的门，本文件不是那份证据。
- 源码版本 0.0.80 和 SHIP_PLAN 正文里的 0.0.75 不是同一个候选。发哪一个，以老板在 §6 写下的证据为准。
- 回滚 feed 挡不住已经装上的机器。见下一节。
- #1504、#1724 也改 `Localizable.xcstrings` / `AppState+NativeUpdate.swift`。本分支停在 main 上，合并时可能冲突。

## 怎么再跑一遍

无私钥、无网络、无上传：

```sh
node tooling/scripts/update-feed-dry-run.mjs --output docs/reports/update-prep-2026-10-24
node --test tooling/scripts/tests/update-feed-dry-run.test.mjs
```

脚本拒绝把文件写进 `services/control-plane/public/`。校验：Sparkle build 高于线上最高 build，短版本高于线上 0.0.67，Windows 版本高于 0.0.34，签名是占位符且不是从线上抄来的，`readManifest` 接受 canonical manifest。

## 老板才做的步骤

1. 在 SHIP_PLAN §6 写下 G1 / G2（0.0.75 口径）或新候选的证据。代理人不改那些勾。
2. 选定一个源码 SHA、版本、build，以及真正的 `TONO_UPDATE_RELEASE_SEQUENCE`。不要用本目录的 `1`。
3. 在现有的签名环境里分别打 macOS 和 Windows 包。两端必须是同一个 SHA、同一个 sequence。
4. 按 `docs/UPDATE_INTEGRATION_V1.md` 的 measure → assemble → 隔离签名 → bundle。签的是 manifest 字节，不要重新序列化。
5. G4.2 先在老板自己的机器上走更新通道。G4.3 才动客户 appcast / `latest.json`，并且 Windows 发布行要有 `verifiedAt`。
6. 不要上传本目录。不要把 `UNSIGNED-DRY-RUN` 或 `example.invalid` 写进客户源。

## 回滚

依据 SHIP_PLAN G4.4（约第 366 行）和 `docs/RELEASE_LINES.md` 的 Rollback：

1. 只把客户源里的 `latest.json` 和 appcast 改回上一个好条目（现在是 Windows 0.0.34、macOS build 67 / 0.0.67）。然后按现有步骤部署 Worker。不改已经装上的程序。
2. 这只能挡住还没升级的机器。已经升上去的 macOS 拒绝更低的 build，已经升上去的 v1 客户端拒绝更低的 `releaseSequence`。Windows 旧通道同样拒绝更低版本。
3. 要把已升级的机器拉回来：用上一个好源码打一个更高的包（macOS 更高 build，Windows 更高版本），再走正常签名和发布。不能靠把 feed 指回旧版本。
4. Worker 本身的回滚是每个 Worker `npx wrangler rollback`。数据库 migration 不回滚。那不是这次的事。
