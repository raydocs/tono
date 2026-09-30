# 选择性放行：可行性（2026-09-30）

老板决定（同日，写在这份记录之后）：崩溃或卡死、且不是严格断网时，**先完整放开普通流量**，用户始终有网络。窄层只作为第二层：第一方 AI 后缀的系统解析沉洞，加上 Anthropic 公布的入站前缀 `160.79.104.0/23` 和 `2607:6bc0::/48`。这一层只有在不可能挡住普通流量和强制门户登录时才能存在，「恢复网络」必须把它删掉。客户在中国大陆，这些 AI 服务本来就无法直连，崩溃后的真实 IP 暴露有限。绝不为它牺牲上网。

[#701](https://github.com/raydocs/tono/pull/701) 和 [#703](https://github.com/raydocs/tono/pull/703) 仍未合入。窄层的实现放在它们上面，合并被挡住，等这两份先合。

下面是做这个决定之前的研究。CDN / ASN 拦截仍然否决。包过滤仍然不能保证「真实 IP 永不到达」。

归属：不属于 0.0.74 的 G1–G4，也不属于运维计划里的某一条。只是设计记录。

## 结论

包过滤做不到「真实 IP 永不到达」。在不把机器断网的前提下，能做的只有文首那一层很窄的第二层。下面这些做法不能装。

否决：

- 按 Cloudflare、Fastly、Azure、Google 或 ASN 拦目的地址。这些前缀是别人的网站和门户登录共用的。
- 把连接时使用的 `CLAUDE_HOME_DOMAINS`（80 个后缀）原样拿来当崩溃拦截名单。里面有 Stripe、npm、GitHub、Datadog、Cloudflare 质询、Meta、Facebook、Gmail 和 Google 登录。
- 在内核里看 TLS SNI。PF 和 WFP 都看不见 SNI；做成驱动是崩溃风险。
- 核心已死时再去网上拉一份新地址表。那次拉取走真实 IP，表也可以被投毒。

可以以后再考虑、这次不写进系统的做法：先撤掉「阻断全部」，再只对第一方专属域名做系统解析沉洞，并只静态阻断 Anthropic 公布的入站前缀。隧道恢复健康后删掉这些规则，重新武装完整保护。严格模式保持「阻断全部」。

这条后路必须等 [#701](https://github.com/raydocs/tono/pull/701)（开机不再装入全阻断）和 [#703](https://github.com/raydocs/tono/pull/703)（自愈改为整网放行）合入，并且紧急解除能删掉沉洞。在那之前接线，会和他们正在改的放行路径打架，也可能把一条删不掉的解析规则留在安全模式里。

## 包过滤看得见什么

macOS PF（`tooling/scripts/core-helper/KillSwitchPF.swift`）和 Windows WFP 按目的地址、端口、接口匹配。Windows 还可以按应用。两边都看不见主机名，也看不见 TLS 里的 SNI。

现有终止规则是 `block drop out quick all`。保护中的 DNS 指向环回或 TUN 上的监听器（macOS `127.0.0.1`，Windows NRPT 指向 `198.18.0.2`）。核心一死，这个监听器也死。若这时仍留着「全部域名都问这个监听器」的规则，整台机器没有解析，比「只挡住 AI」更差。#701 要拆的就是开机时装入这条全阻断、以及留下指向 `127.0.0.1` 的解析。

所以：没有隧道进程时，过滤器只能拦已知的 IP 前缀。名字要靠系统解析器（macOS `/etc/resolver/<域名>`，Windows 按命名空间的 NRPT），不能靠那条全匹配规则。

## 2026-09-30 的实测解析

在写这份记录的环境里用 `dig` 看的 A/AAAA。客户网络上的 Cloudflare 任播可能不同；Claude 今天返回的是源站地址，不是任播。

| 名字 | 答案 | 含义 |
|---|---|---|
| `claude.ai`、`api.anthropic.com`、`claude.com` | `160.79.104.10`，AAAA `2607:6bc0::10` | 落在 Anthropic 公布的入站前缀里 |
| `chatgpt.com`、`openai.com`、`chat.openai.com`、`api.openai.com` | `104.18.0.0/16`、`172.64.0.0/13`、`162.159.0.0/16` | Cloudflare 任播 |
| `grok.com`、`x.ai`、`perplexity.ai` | 同一类 Cloudflare 地址 | 共用边缘 |
| `gemini.google.com`、`generativelanguage.googleapis.com` | `142.251.0.0/16`、`172.217.0.0/16` | Google 任播，和搜索等服务共用 |

`claude.ai` 和 `chatgpt.com` 的 NS 都是 Cloudflare。今天 Claude 的 A 记录指向自己的地址，不代表明天不会改成橙色云代理。改了之后，只拦 `160.79.104.0/23` 就不再覆盖网页和 API。

## 公布的地址能不能用

Anthropic 的 [IP addresses](https://platform.claude.com/docs/en/api/ip-addresses)（查阅于 2026-09-30）：

- 入站（别人连向 Anthropic）：IPv4 `160.79.104.0/23`，IPv6 `2607:6bc0::/48`
- 出站（Anthropic 去连别人，例如 MCP）：IPv4 `160.79.104.0/21`

仓库里已有 `CLAUDE_HOME_IPV4_CIDRS = ["160.79.104.0/21"]`，注释写明这是 ARIN AP-2440 / AS399358 的第一方单播，客户审计里作为裸目的地址出现的是 `160.79.104.10:443`。运行时 `ipv6: false`，所以连接期间 AAAA 不进 TUN。崩溃放行之后，系统自己的 IPv6 会走到 `2607:6bc0::/48`。只拦 IPv4 就留着一条 IPv6 直连。

这组前缀是第一方的，误伤普通网站的面很小。它覆盖不了 Cloudflare 上的 ChatGPT，也覆盖不了 Claude 一旦改走任播之后的流量。出站 `/21` 比入站 `/23` 大；多拦的是 Anthropic 自己出去的地址，不是客户要访问的网站。若以后真的加静态规则，用公布的入站两条（`/23` 和 `/48`）即可，不要扩到整个 AS。

OpenAI 公布的 [egress ranges](https://developers.openai.com/api/docs/guides/ip-addresses) 是 ChatGPT 向外连接时的源地址（插件、连接器、Codex 云），不是用户浏览器要连的目的地址。拿来当目的拦截，挡不住今天的 `chatgpt.com`，还可能打进 Azure 上别人的网段。Fastly 和整段 Azure 同理，否决。

Google 的 Gemini 地址和大量无关的 Google 服务重叠。拦这些前缀会拆掉搜索和其它站点。否决。

地址表会变。Anthropic 文档已经列过废弃的 `34.162.46.92/32` 等。OpenAI 要求定期重新拉取。核心死掉时不能拉。能进客户端的只有发版时冻在二进制里的表，过几天就旧。

## 解析沉洞能挡住什么

macOS 的 `/etc/resolver/<名字>` 和 Windows 按后缀的 NRPT 可以在没有核心的情况下，让系统解析器对指定后缀返回失败或一个不可路由的地址。这不影响其它名字，所以门户登录和普通上网还在。

它挡不住：

- 已经缓存的 A/AAAA，以及还活着的 TCP/QUIC
- 直接写 IP 的客户端
- DoH / DoT（产品在连接时会管浏览器的安全 DNS，崩溃之后管不住每一种）
- 不用 mDNSResponder / NRPT 的程序
- 名单里没有的新主机名
- 只沉洞 A、却留着缓存 AAAA 的情况

沉洞名单必须比 `CLAUDE_HOME_DOMAINS` 窄，只留第一方专属后缀，例如 `anthropic.com`、`claude.ai`、`claude.com`、`openai.com`、`chatgpt.com`、`oaistatic.com`、`oaiusercontent.com`、`x.ai`、`grok.com`、`perplexity.ai`。不要放 `stripe.com`、`registry.npmjs.org`、`storage.googleapis.com`、`challenges.cloudflare.com`、`datadoghq.com`、`sentry.io`、`meta.com`、`facebook.com`、`gmail.com`、`accounts.google.com`。`chat.com`、`ai.com` 太泛，先不放。`gemini.google.com` 只能精确到那台主机，不能沉洞 `google.com`。

全匹配 NRPT（「`.`」→ `198.18.0.2`）和「所有解析都去 `127.0.0.1`」都是整机断解析。选择性放行禁止再用它们。

## 看门狗和开机

没有核心时，谁来装、谁来拆：

- #701 的方向是：`/etc/pf.conf` 只声明锚点，不从规则文件 `load anchor`；助手发现核心不在就放行 PF 并恢复 DNS；大约 30 秒的空闲检查后放行；`--emergency-disarm` 即使 DNS 恢复失败也要放行 PF。macOS 今天没有用户可开的「严格断网」。保存的 `killswitch.state` 不是这个开关。
- 因此现在每一台 Mac 都落在「非严格」一侧。一旦把选择性规则做成崩溃默认，影响的是全部客户，不是一个隐藏开关后面的人。
- Windows 侧 #703 写明：严格只等于 macOS 的 Permanent；Windows 不会选它。WFP 的损坏意图紧急阻断不在 #701 的改动里。`wanted: false` 仍是现有的整网放行出口。
- 选择性规则不能写进那份会在开机被装入的可变规则文件。一份常量、只有两条「阻断到 Anthropic 入站前缀」、没有 `block drop all` 的文件，本身不会把机器断网。但 #701 正在改同一条开机路径。现在加第二条开机装入，容易把「从可变文件装入」带回来。
- 沉洞文件会活过安全模式。紧急解除必须删除 `/etc/resolver` 里的这些文件和对应的 NRPT 项。这个删除路径就在 #701 正在改的助手里。先写沉洞、后补删除，会留下没有卸载按钮的黑洞。

强制门户：客户端里没有检测器。现有的 generate_204 是出口健康探测，不是门户检测。误报会在用户以为仍被完整保护时拆掉全阻断；漏报会继续挡住门户登录。检测器以后若要做，非严格模式下必须偏向放开普通流量，不能偏向留下 `block drop all`。检测器和防火墙不要放在同一次改动里。

## 建议的状态机（未实现）

只在「非严格，且崩溃、卡死或强制门户」时进入选择性放行：

1. 撤掉 `block drop all` 和指向已死监听器的全匹配 DNS。普通流量回到原来的网络。
2. 装上窄沉洞。若同时装前缀阻断，只包含 `160.79.104.0/23` 和 `2607:6bc0::/48`，单独常量文件，规则里不能出现「阻断全部」。
3. 隧道再次健康：删除沉洞和前缀阻断，重新武装完整保护。
4. 用户明确选择恢复网络：连沉洞和前缀阻断一起删。否则没有界面能退出，机器会一直打不开这些名字。
5. 用户明确断开：回到原来的网络，不留下 AI 拦截。老板点名的是崩溃、卡死和门户，不是用户自己关掉。
6. 严格 / Permanent：保持全阻断，不做选择性放开。恢复仍然必须有保证，这条不在本文件里放宽。

#703 在保护已举起、出口失败时会整段放开，并不保留 AI 拦截。选择性拦截若以后要加，是他们放行之后的附加层，不是替换他们的放行，也不要改他们的文件。

## 泄漏（不能声称的事）

即便以后按上面的窄方案装上，下面仍然成立：

- ChatGPT、Grok、Perplexity、Gemini 的网页和 API 今天不在 Anthropic 前缀里。沉洞可以被 DoH、缓存、IP 字面量和非系统解析器绕过。
- Claude 今天可以被入站前缀盖住。DNS 托管在 Cloudflare，A 记录可以改成任播，前缀规则随后失效。
- 新域名、IPv6 漏拦、二进制里的旧名单，都会漏。
- 没有门户检测器。误判要么过度放开，要么继续挡住登录。

因此不能对用户说「真实 IP 不会到达 AI 服务」。现在的非严格崩溃行为，在 #703 合入后是整网放行；本记录不把暴露面再扩大，也不把一个做不到的保证写成已实现。
