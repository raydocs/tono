# R3-T1 Grok 续记（2026-10-01）

Hunter: Grok 4.7。槽位 R3-T1-grok 的续记。前一份记录是 [#941](https://github.com/raydocs/tono/pull/941)。本轮基线 `origin/main` `c2626f53`。审查的发布脚本与这条基线字节相同；zip 闸门的实现在 [#952](https://github.com/raydocs/tono/pull/952)，头 `1b8931ca`，叠在 [#939](https://github.com/raydocs/tono/pull/939) `58823ab9` 上，尚未合 main。

跳过 [#908](https://github.com/raydocs/tono/pull/908)。本轮没有要另开的 GitHub issue。

## 补上的缺口

[#941](https://github.com/raydocs/tono/pull/941) 记下：发布门检查的是单独传入的 `--app`，一份已过门的 app 可以配上另一份已用 Sparkle 私钥签过的 zip。

[#952](https://github.com/raydocs/tono/pull/952) 在写 feed 之前做两件事。zip 里 `Tono.app/` 下每个普通文件的字节，以及每个符号链接的链接文本，必须和 `--app` 一致；`__MACOSX/` 不参与比较。然后把门跑在从这份 zip 解出来的 `Tono.app` 上。路径逃出 zip、符号链接指向解压目录之外，都拒绝。测试 `the release gate sees the app inside the zip, not a different --app`：两份 Info.plist 相同、`Contents/marker` 不同时，退出码非 0，stderr 匹配 `not byte-identical to Tono.app inside the zip`，feed 不变。把 `--app` 覆盖进 zip 并重签之后，退出码仍非 0，拒绝行是 `verify-release-gate.sh rejected`，被检查的路径不是传入的 `--app`，feed 仍不变。

`desktop-update-sign.yml` 的 `macos-verify` 本来就是从同一份包 zip 用 ditto 解出 app，再跑门。那条 v1 链没有这个缺口。

## 第二轮审查

| 对象 | 结论 |
|---|---|
| `notarize-macos.py` | 状态不是 Accepted 时返回非 0；提交退出码已非 0 时保留该退出码，否则返回 65。诊断只留 id、状态和 issue 字段，原始 stdout 不落盘。`package-macos-test.sh` 有 `set -eu`，公证失败不会进入 stapler。装订之后删掉旧 zip，用已装订的 app 重新打包 |
| `upload-release-asset.mjs` | 上传后用 HEAD 的 `content-length` 对照发布资产大小。客户边界在频道提升：`validate-windows-channel.mjs` 下载桶里的对象，用更新签名核对那一份字节，并把地址改写成 `https://releases.afk.ccwu.cc/download/`。长度相同、内容不同的对象过不了这道签名 |
| `publish-managed-catalog.rb` | hy2 仍要求指纹、口令占位符，并把 `skip-cert-verify` 除 `false` / `no` / `off` / `n` 以外的值当成跳过校验而拒绝。管理令牌来自钥匙串，用完覆写，不打印。目录是管理令牌下的结构校验，不是另一道 Sparkle 签名 |
| `windows-package-components.mjs` | 按安装路径取 `Tono.exe.next`、`tono-core.exe.next`、`resources/tono-service.exe`。符号链接、大小写重复路径、与安装副本不一致的额外副本都拒绝 |
| `verify-release-gate.sh` | `set -eu`。`codesign -dv` 上的 `\|\| true` 只为读到文本；Authority 为空或不是 Developer ID Application 记失败。`get-task-allow` 这个字符串出现即失败。嵌入列表与 Xcode Embed Executables 阶段一致 |
| `desktop-update-sign.yml` | 只接受 `refs/heads/release/windows`，频道必须是 `release`，`TonoBuildChannel` 必须为空。先 stapler、`spctl` 和发布门，再签名。Sparkle 私钥走 stdin。没有 `\|\| true` |
| `desktop-update-candidate.yml` | 只装配未签名候选，不持有签名密钥，不上传，没有 `\|\| true` |
| `macos-release.yml` | 构建作业在 `codesign`、stapler、`spctl` 之后跑发布门。appcast 作业从同一份 zip 解出 `--app`。`find \| head` 在 `pipefail` 下多包会让作业变红。钥匙串那两处 `\|\| true` 是 `always()` 清理，跑在托管 runner 上 |
| `windows-release.yml` | 错误 ref 让 `branch` 作业变红，而不是跳过变绿。产物先是草稿。安装包和 `.sig` 用构建作业记下的 sha256 核对。`latest.json` 里 `windows-x86_64` 与 `windows-x86_64-nsis` 指向同一个 NSIS 安装包和同一条签名。提升时再按桶内字节验签 |
| `release-qualification.yml` | 没有签名密钥，没有 `\|\| true`，没有频道发布 |

`apps/windows/app/.github/workflows/release.yml` 和 `apps/windows/service/.github/workflows/release.yml` 不在仓库根的 `.github/workflows/`，GitHub 不会把它们当成本仓库的工作流来跑。客户 Windows 通道是根上的 `windows-release.yml`。

## 看过、不单开 issue 的两点

同一 hy2 块里先写 `skip-cert-verify: false` 再写 `true` 时，`publish-managed-catalog.rb` 和 `catalog-yaml.ts` 的正则都只看第一处，文本检查会放行。macOS `parseClashYAMLProxies` 后写覆盖，看到 `true` 后 `ConfigPipeline` 因 `skipCertVerify == true` 丢掉该节点。Windows `admit_hysteria2` 在反序列化值为 `true` 时拒绝该节点。两边生成的运行配置都不写出这个字段。本机没有 cargo，没有再跑 serde 对重复键是报错还是取后者；两种结果都不会把证书校验关掉。

Sparkle 2.9.6 `sign_update/main.swift` 在 base64 解不开时，用 `print` 把那段文本打到 stdout（`Failed to decode base64 encoded key data from:`）。`desktop-update-sign.yml` 把 stdout 收进变量，失败时只打「输出已扣下」。`macos-release.yml` 同样用命令替换收走 stdout，`set -eu` 在打印它之前退出。这不是当前日志泄漏。

## 本地验证

主机是这台 Linux，Node v22.14.0。

- `node --test tooling/scripts/tests/publish-macos-appcast-gate.test.mjs tooling/scripts/tests/windows-package-components.test.mjs`：3 passed。含 `the release gate sees the app inside the zip, not a different --app` 和 `measures the installed payload copy and refuses a gate copy that differs`。
- `python3 tooling/scripts/tests/test_notarize_macos.py`：6 tests OK。Accepted 返回 0；退出码 0 且状态不是 Accepted 返回 65；非 0 退出码被保留；诊断里没有 `never-persist`。
- `python3 tooling/scripts/tests/test_macos_release_gate_core.py`：1 test OK。门里的嵌入列表等于 Embed Executables 阶段。
- Ruby 不在这台机器上，`publish-managed-catalog.test.rb` 本轮没跑。没有 macOS，没有跑 `macos-release` 或 `desktop-update-sign`，没有公证，没有发布目录或频道。

## 剩余限制

字节比较不含资源叉，也不含 `__MACOSX` 以外的 AppleDouble。没有用 ditto 打出来的 zip 做往返。若 python `zipfile` 解出的 ditto 包与磁盘上的 app 对不上，发布拒绝，不会写出 feed。

[#935](https://github.com/raydocs/tono/pull/935) 与 [#952](https://github.com/raydocs/tono/pull/952) 都改 `publish-macos-appcast.mjs`，改的不是同一处。两份都开着自动合并。[#952] 的历史包含 [#939](https://github.com/raydocs/tono/pull/939) 的提交；[#952] 先合会把 [#939] 的提交一起带上 main。

本报告不开自动合并。
