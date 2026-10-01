# R3-T1 Grok（2026-10-01）

Hunter: Grok 4.7。槽位 R3-T1-grok。基线 `origin/main` `4453e258`。范围：`release-macos.sh`、`notarize-macos.py`、`publish-macos-appcast.mjs`、`upload-release-asset.mjs`、`publish-traffic-policy.mjs`、`publish-managed-catalog.rb`、`verify-release-gate.sh`、`windows-package-components.mjs`，以及 `desktop-update-*` / `macos-release.yml` / `windows-release.yml` / `release-qualification.yml`。

跳过 [#908](https://github.com/raydocs/tono/pull/908) 的流量策略管理员令牌源站钉。W2 报告 [#922](https://github.com/raydocs/tono/pull/922) 里还没证明的两项，本轮都钉住了。

没有新的未修缺陷，所以没有要另开的 GitHub issue。

## 结论

| ID | 区域 | 严重度 | 文件 | 一句话 | 结论 |
|---|---|---|---|---|---|
| REL-APPCAST-HOST | T1 | P2（中·已确认） | `publish-macos-appcast.mjs` `validateEnclosureUrl` | `--expected-host` 把下载主机从 `releases.afk.ccwu.cc` 换成调用方给的值，同一个值还套到 GitHub 发布页 | 已修 [#935](https://github.com/raydocs/tono/pull/935)，头 `f7f65b2f`。自动合并已开一次 |
| REL-APPCAST-GATE | T1 | P2（中·已确认） | `publish-macos-appcast.mjs` 写 feed；`macos-release.yml` 构建作业 | Sparkle 手动发布和 dry-run 不跑发布门。签名只覆盖 zip 字节，一份没有 Developer ID 的包也能写进 feed | 已修 [#939](https://github.com/raydocs/tono/pull/939)，头 `58823ab9`。自动合并已开一次 |

## 两项是怎么钉住的

`--expected-host evil.example` 时，`validateEnclosureUrl` 接受 `https://evil.example/download/tono-0.0.2-build43/Tono-0.0.2-build43-arm64.zip`。`buildAppcastUpdate` 把同一个主机传给发布页链接。修复前测试 `expected-host cannot move the download URL off the release host` 失败，输出是 `Missing expected exception`。修复后下载主机固定为 `releases.afk.ccwu.cc`，路径前缀固定为 `/download/`，发布页固定为 `github.com`。与默认值相同的参数仍然接受，所以 `macos-release.yml` 里已有的 `--expected-path-prefix /download/` 不用改。

Sparkle 手动发布：`macos-release.yml` 的 `validate-appcast` 只以 `--dry-run` 跑 `publish-macos-appcast.mjs`，步骤摘要让操作者去掉 `--dry-run` 再写 feed。这个脚本不调用 `verify-release-gate.sh`。构建作业只做 `codesign --verify`、stapler 和 `spctl`，没有 helper 的 client requirement。用一份只有 zip 魔数和一份伪造 Info.plist 的包调用发布命令，修复前退出码是 0，feed 被写上。修复后 dry-run 和真正写入都会先跑发布门，退出码非 0，feed 不变。`macos-release.yml` 的构建作业也跑这道门，`candidate_only` 不会再绕过它。

`release-macos.sh` 原来把门的输出交给 `grep -c '^  ok:'`，再判断 `>= 6`。bash 复现：六条 `ok:` 且管道退出 1 时，`pipeline_status` 是 1、`count` 是 6、判断结果是 PASS。今天的门脚本在失败时会少一条 `ok:`，所以这条计数当下不会单独把失败放过去。脚本已改为使用门的退出码。

`desktop-update-sign.yml` 的 `macos-verify` 在签名前已经跑 `verify-release-gate.sh`。那条 v1 更新链不是这次的洞。

## 本地验证

- `node --test tooling/scripts/tests/publish-macos-appcast.test.mjs`：主机钉修复前 1 failed，修复后 27 passed。
- `node --test tooling/scripts/tests/publish-macos-appcast-gate.test.mjs tooling/scripts/tests/publish-macos-appcast.test.mjs`：门修复前发布退出码 0，修复后 27 passed。
- 本机 Node 是 v22.14.0。没有 macOS，没有跑 `macos-release` 或 `desktop-update-sign`，没有公证，没有发布目录或策略。

## 否掉的假设

| 假设 | 为何否掉 |
|---|---|
| 公证失败仍继续装订 | `notarize-macos.py` 在状态不是 Accepted 时返回非 0，并写明不许装订或发布 |
| `verify-release-gate.sh` 用 `\|\| true` 放过未签名嵌入文件 | `\|\| true` 只为了读到 `codesign -dv` 的文本；Authority 为空或不是 Developer ID 时记失败 |
| 目录发布不验 `skip-cert-verify` | W2 已否。`publish-managed-catalog.rb` 仍要求 hy2 指纹且拒绝 `skip-cert-verify: true`。目录本身是管理令牌下的结构校验，不是另一道 Sparkle 签名 |
| 流量策略可以无签名发到任意源站 | 无密钥且服务端不要求签名时，脚本写明可以发未签名修订。源站钉是 #908，本轮不改 |
| `upload-release-asset` 只核对长度就能换客户更新包 | W2 已否。客户安装前仍验签名 |
| `windows-package-components` 会量到重复或大小写不同的 exe | 链接、大小写重复、与安装副本不一致都拒绝 |
| `desktop-update-sign` 能从 PR 发布 | 只接受 `workflow_dispatch`，权限是 contents/actions read。macOS 侧先过门再签名 |
| Windows release 的预检失败后仍上传 | 相关步骤设置了 `ErrorActionPreference Stop` 和 `PSNativeCommandUseErrorActionPreference` |
| appcast 作业里 `find \| head` 会在失败时变绿 | `set -euo pipefail` 下这条管道失败会让作业变红，不是放行 |

## 剩余限制

发布门检查的是 `--app`。操作者仍可以把一份已过门的 app 和另一份已经用 Sparkle 私钥签过的 zip 配在一起。`macos-release.yml` 的 dry-run 是从同一个 zip 解出 `--app` 的。没有实机确认 Developer ID 包能通过这道门。

本报告是 [#941](https://github.com/raydocs/tono/pull/941)，不开自动合并。
