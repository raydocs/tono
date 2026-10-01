# macOS 应用侧未认领 issue（2026-10-01）

Hunter: Grok 4.7。基线 `origin/main` `b341164b`。开着的 issue 38 个，开着的 PR 122 个。在 PR 标题和正文里检索 `#N`。评论数为 0 的记为没有新认领。

范围是 macOS App（`apps/macos`），不含特权 helper。跳过 `tooling/scripts/core-helper`、`helper-shared`，以及 #928。

## 可以修的队列

空。没有一条同时满足：macOS 应用缺陷、没有开着的 PR 提到它、没有需要决定或实机才能动、也还没合进 main。

因此这一轮没有新的修复 PR，没有 `Fixes #N`，也没有打开自动合并。

## 已有开着的修复 PR（main 上还在）

这两条不是「已在 main 修好」。`b341164b` 上代码还在：`AppState.swift` 的 `waitForOwnedTunnelInterface`（约 2166 行），`AppState+Connect.swift` 健康心跳里 `if advisory == nil { self.errorMessage = nil }`（约 1777 行）。main 的提交说明里没有这两号。不要关。

| Issue | 等级 | 开着的 PR | 说明 |
|---|---|---|---|
| [#864](https://github.com/raydocs/tono/issues/864) | P2 | [#882](https://github.com/raydocs/tono/pull/882) | 最后一次 sleep 的取消被吞掉，隧道等待仍可能报就绪。自动合并已开，本轮不重开。 |
| [#863](https://github.com/raydocs/tono/issues/863) | 低 | [#885](https://github.com/raydocs/tono/pull/885) | 健康心跳清掉无关的 `errorMessage`。自动合并已开，本轮不重开。 |

正文里还出现这两号的文档 PR：[#876](https://github.com/raydocs/tono/pull/876)、[#888](https://github.com/raydocs/tono/pull/888)。

## 跳过，只列出

| Issue | 原因 |
|---|---|
| [#901](https://github.com/raydocs/tono/issues/901) | 要产品决定。登录已成功，钥匙串写入失败后会话停在 `.error`。#796 之后这次抛出是有意的，两条修法（内存令牌继续登录，或干净退回未登录）还没选。没有开着的 PR 提到它。评论 0。 |
| [#817](https://github.com/raydocs/tono/issues/817) | 未证实，改之前要对照 sing-box。正文写明状态 unconfirmed，并给出两条修法（假 IP，或 `reverse_mapping` / sniff）。`ConfigPipeline+SingBoxProduct.swift` 仍把 web-direct 后缀先送到 `Tono-China-DNS`，假 IP 规则在后面，配置里没有 `reverse_mapping`。产品路径默认关闭。改它会动路由，本轮不改。没有开着的 PR 提到它。评论 0。 |
| [#861](https://github.com/raydocs/tono/issues/861) | 文案。保护 DNS 失败、上行没变时仍说网络变了。开着的 PR 正文里有 #861（#876、#888，以及 #882 / #885 的其他发现）。 |
| [#331](https://github.com/raydocs/tono/issues/331) | 实机。`needs-hardware`。把 macOS 引导期控制面例外绑到只属于 Tono 的身份。没有开着的 PR 提到它。 |
| [#409](https://github.com/raydocs/tono/issues/409) | 实机。`needs-hardware`。把存下的设备身份绑到创建它的那台机器。没有开着的 PR 提到它。 |
| [#422](https://github.com/raydocs/tono/issues/422) | 实机。在真实安装上采集飞书/Lark 的签名身份。没有开着的 PR 提到它。 |
| [#691](https://github.com/raydocs/tono/pull/691) | 不碰。这是开着的草稿 PR（`fix/macos-admin-recovery-20260930`），不是本轮要领的 issue。 |
| [#694](https://github.com/raydocs/tono/pull/694) | 不碰。2026-09-30 已合并，内容是 Windows 登录诊断，不是未关的 macOS 应用缺陷。 |

## 交给 helper 的人，本轮不读

| Issue | 标题 |
|---|---|
| [#928](https://github.com/raydocs/tono/issues/928) | 静默升级打开对端二进制时，FIFO 可能永远堵住 |
| [#897](https://github.com/raydocs/tono/issues/897) | 过期核心 SIGKILL 不再核对 pid |
| [#896](https://github.com/raydocs/tono/issues/896) | 签名检查之后又读一遍已安装更新下限 |
| [#895](https://github.com/raydocs/tono/issues/895) | `pfctl -X` 失败仍忘掉 enable token |
| [#894](https://github.com/raydocs/tono/issues/894) | LAN DNS 拦截仍只覆盖 arm 时存在的网卡 |
| [#893](https://github.com/raydocs/tono/issues/893) | 受保护 DNS 状态仍用显示名当服务键 |
| [#860](https://github.com/raydocs/tono/issues/860) | `readRequest` 没有有界解码测试 |

#928、#897–#893 的正文引用在文档 PR [#920](https://github.com/raydocs/tono/pull/920)。#860 在 [#877](https://github.com/raydocs/tono/pull/877)。

## 已在 main 修好、可以关的

无。上面两条 macOS 应用缺陷的修复都还在未合并的 PR 里。

## 网络

本 PR 不改路由、TUN、PF、DNS、防火墙、杀开关或代理。没有把普通失败收紧成全拦，也没有放开 AI 拦截。
