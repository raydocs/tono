# 实机测试总清单（2026-10-01）

给测试的静杰，也给老板看。一次构建，一份清单。不按 PR 逐个测。

- 基线：`main` `0676435b`（2026-10-01 夜间；第 4、5 节和附录最初写在 `7d9e8bad`，即 #1048 合入之后，第 6 节补到现在）。来源：带 `needs-hardware` 标签的 PR（原 151 个，夜间又新增 60 个：58 个合入、1 个关闭、1 个仍开着（#1188）），issue #331 #409 #422 #602，[RELEASE_READINESS](../RELEASE_READINESS.md)，[selective-fail-open](../selective-fail-open.md)，[Windows 设备验收](../WINDOWS_0_0_72_DEVICE_ACCEPTANCE.md)，[Windows 默认核报告](2026-10-01-windows-sing-box-default.md)。
- 只收真要在系统上跑的项。逻辑已被 CI 回归测试盖住、设备上又没法安全触发的，放到附录 A，一行一个。
- 标记：**[VM]** 虚拟机可测（macOS 用 UTM / Parallels 的 macOS 客户机；Windows 用 x64 虚拟机，Hyper-V / VMware / VirtualBox）。**[真机]** 必须真机：真实网卡、Wi-Fi 切换、睡眠唤醒、真实安装 / 升级 / 卸载、住宅宽带。
- Windows 虚拟机要用 x64。Apple Silicon 上的 Windows ARM 虚拟机跑 x64 的 TUN 驱动不可靠，那里出的结果不算数。
- 总数：[VM] 52 项，[真机] 19 项（含 1 项可选）。另有 2 组要等签名候选（第 7 节），附录 A 列 CI 已覆盖的 PR，附录 B 列 5 个仍开着的 PR。第 6 节是夜间新增，其中 Windows 默认内核 sing-box 的项（W20–W33）要用带 `sing-box.exe` 的候选包。顺利的话 VM 部分约 5 小时，真机部分约 3 小时，浸泡另算。

## 0. 先备份（必须先做）

1. **不要在主力工作机上测。** 用虚拟机，或一台空闲的测试机。[VM] 项全部在虚拟机里做。每组开始前打一个快照，坏了就回滚，这是最省事的恢复办法。
2. 真机项用一台空闲的 Mac / PC。先做完整备份：Mac 用 Time Machine，Windows 建还原点并备份用户目录。用测试账号登录 Tono，不要用个人账号。
3. 手边留一台能上网的设备（手机热点也行），以便本机断网时还能看这份文档。远程控制（SSH、Tailscale、远程桌面）可能被测试本身切断，真机项要有人坐在机器前面。见 [Windows 设备验收 §1](../WINDOWS_0_0_72_DEVICE_ACCEPTANCE.md)。
4. 记一份基线，测完逐项对比：

   macOS：
   ```sh
   networksetup -listallnetworkservices
   networksetup -getdnsservers "Wi-Fi"        # 对每个在用的服务
   scutil --dns | head -40
   sudo pfctl -s info | head -3                # Status: Enabled/Disabled
   sudo pfctl -a tono.killswitch -sr           # 未连接时应为空
   ls /etc/resolver 2>/dev/null
   netstat -rn | grep -E '160\.79\.104|2607:6bc0'
   ```
   Windows（管理员 PowerShell）：
   ```powershell
   Get-NetAdapter | Select-Object Name, InterfaceIndex, Status
   Get-DnsClientServerAddress | Select-Object InterfaceIndex, AddressFamily, ServerAddresses
   Get-DnsClientNrptRule
   netsh wfp show filters file="$env:TEMP\wfp-base.xml"; (Select-String "$env:TEMP\wfp-base.xml" -Pattern '>Tono ').Count
   netsh advfirewall firewall show rule name="Tono selective anthropic v4"
   ```
5. **Windows 加测内核相关项（第 6 节）之前，再备份三样东西：** `Program Files\Tono` 整个目录（含 `sing-box.exe`、`sing-box-sha256.txt`、`tono-core.exe`）、App 数据目录下的 `sing-box-core.json`（没有就记「无」）、Service 日志位置。改完要能一键恢复；虚拟机直接用快照。

## 1. 断网了怎么恢复

按顺序试，前一步好了就停。下面的命令都出自仓库文档或安装器，不是新编的。

### macOS

1. App 里点「断开」。处于「保护离线」时，菜单栏或主窗口会出现「恢复网络」，点它。
2. 终端：`sudo /Library/PrivilegedHelperTools/tono-core-helper --emergency-disarm`。它放行 PF，尽量恢复 DNS，DNS 恢复失败也会放行 PF（#711 / 决策 032），并删除 AI 窄层（#738）。
3. 还不行：`sudo /Library/PrivilegedHelperTools/tono-core-helper --emergency-reset`。这是 App 支持页上的命令，放行网络后移除 helper。更新账本坏掉时它也先放行，只是不删安装。
4. helper 本身起不来，或在安全模式 / 恢复系统里（出自 [macos-boot-anchor](../changelog.d/2026-09-30-macos-boot-anchor.md)）：
   ```sh
   sudo pfctl -a tono.killswitch -F all
   sudo pfctl -d
   ```
   若 `/etc/pf.conf` 里还有 `# BEGIN TONO KILL SWITCH` 和 `load anchor "tono.killswitch" from`，删掉 BEGIN 到 END 之间的内容（连同这两行标记），再执行 `sudo pfctl -f /etc/pf.conf` 和 `sudo pfctl -d`。DNS 仍是 `127.0.0.1` 时，对每个在用的服务：
   ```sh
   networksetup -listallnetworkservices
   sudo networksetup -setdnsservers "Wi-Fi" Empty
   ```
5. 重启：macOS 开机不再从 `pf.conf` 装入阻断（#701）。但[发布就绪](../RELEASE_READINESS.md)写明，新 helper 至少成功启动过一次之前，安全模式下仍要手工执行第 4 步。
6. 卸载：macOS 没有 pkg 卸载器。删掉 `/Applications/Tono.app` 后，helper 大约每 10 秒放行一次 PF（#710）。要把 helper 一起删掉，用第 3 步。
7. 只是 Claude / ChatGPT 等打不开、其他网站正常：这是 AI 窄层（`/etc/resolver/<后缀>` 指向 `192.0.2.1`，外加 `160.79.104.0/23` 和 `2607:6bc0::/48` 的黑洞路由），不影响普通上网。第 1 步的「恢复网络」或第 2 步会删掉它。

### Windows

1. App 里点「断开」。「保护离线」时点「恢复网络」。
2. 开始菜单 **「Tono — 恢复网络 (Restore Network)」**，右键「以管理员身份运行」。它执行的是 `"C:\Program Files\Tono\resources\tono-service.exe" --emergency-disarm`。服务还握着 owner lock 时会拒绝（[发布就绪](../RELEASE_READINESS.md)），这时先退出 Tono 再运行。
3. 还不行：管理员命令行执行 `sc stop TonoService`。#792 之后，普通的服务停止也会恢复 DNS、放行非严格 WFP。停完再运行一次第 2 步。
4. 再运行一次安装程序或卸载程序。安装程序发现没有服务能解除的残留拦截时，会先解除再重装；卸载程序先跑 emergency-disarm，证明不了拦截已解除就不删文件。
5. **不要先重启。** 安装器原文：重启清不掉拦截，反而更糟，因为阻断过滤器会活过重启，旁边的环回和 DHCP 例外却不会。#753 已把这些例外改成持久，但真机没验证之前，仍按安装器说的先做第 2–4 步。
6. 检查是否干净：`netsh wfp show filters` 里没有名字以 `Tono ` 开头的过滤器；`Get-DnsClientServerAddress` 与基线一致；`Get-DnsClientNrptRule` 里没有指向 `192.0.2.1` 或 `198.18.0.2` 的规则；名为 `Tono selective anthropic v4` / `v6` 的防火墙规则只在 AI 窄层生效时才应该存在。

## 2. 要验证的头号规则

**Tono 不能把用户断网。** 出故障时退回普通网络，同时仍挡住 AI 域名和 IP（AI 窄层：第一方 AI 后缀走系统解析沉洞 `192.0.2.1`，Anthropic 前缀 `160.79.104.0/23`、`2607:6bc0::/48` 走黑洞）。只有显式的严格模式才全阻断。

每个 fail-open 项都看三件事：

1. **普通网络回来了**：`curl -m 10 -sI https://www.baidu.com` 成功；DNS 回到基线；macOS 上 `sudo pfctl -a tono.killswitch -sr` 为空，Windows 上没有 `Tono ` 过滤器。
2. **AI 窄层在**：`curl -m 10 -sI https://claude.ai` 失败。macOS 上 `/etc/resolver/claude.ai` 存在且内容是 `nameserver 192.0.2.1`，`netstat -rn | grep 160.79.104` 有黑洞路由。Windows 上 `Get-DnsClientNrptRule` 有 `claude.ai` → `192.0.2.1`，并有 `Tono selective anthropic v4/v6` 防火墙规则。
3. **用户点「恢复网络」或「断开」之后，窄层被删掉**（这是设计如此）。

AI 窄层只是尽力而为。它挡不住 DoH、已缓存的地址、IP 直连，也挡不住 ChatGPT 这类在 Cloudflare 上的真实 IP（[selective-fail-open](../selective-fail-open.md)）。测试只看上面三点，不要求「真实 IP 绝对到不了 AI」。

严格模式：两个平台的生产版都**没有用户可开的严格开关**（Windows 生产版不写 `strict_kill_switch`，macOS 不存这个模式），所以本轮不测，只由 CI 单测覆盖。

### 已知缺口（不是测试项，不按「应通过」判）

- **macOS App 侧的选择性 AI 钩子没有注册。** `selectiveAiBlockReady` 恒为 false（`ProtectedConnectivity.swift`、`ExitHeal.swift`）。目前在放行后会装 AI 窄层的路径有：helper 侧的自动放行（崩溃 / 卡死看门狗 #738，更新失败 #971，睡眠屏障失败与孤儿 bootstrap #1028），以及 App 的连接耗尽失败（#1048，走 `/killswitch/release`）。**其他 App 侧的自动放行是整网放行，不保留 AI 拦截**，包括 [#963](https://github.com/raydocs/tono/pull/963)（目录里的出口消失）和 [#966](https://github.com/raydocs/tono/pull/966)（策略应用失败），两者都还没合入。在 macOS 上看到普通网络恢复、但 claude.ai 能直连的，若不属于上面列出的那几条路径，记为已知缺口，不判失败。
  - **更新（2026-10-01 夜间）：** 此后合入的 [#963](https://github.com/raydocs/tono/pull/963) [#966](https://github.com/raydocs/tono/pull/966) 已经在 main，并且 [#1061](https://github.com/raydocs/tono/pull/1061) [#1099](https://github.com/raydocs/tono/pull/1099) [#1103](https://github.com/raydocs/tono/pull/1103) [#1146](https://github.com/raydocs/tono/pull/1146) [#1178](https://github.com/raydocs/tono/pull/1178) 按各自 PR 的说明，把 App 侧的自动放行改成保留 AI 层（走 `releaseAfterFailure`，`preserveAIHold:true`）。所以第 6 节 M18 里这些路径上「普通网络恢复、claude.ai 能直连」要判失败，不再按已知缺口放过。第一条说的「钩子没有注册」是否仍成立，以测试结果为准：看到就写进记录，让开发核对 `selectiveAiBlockReady`。
- **用户主动退出 / 断开会把 AI 窄层一起删掉**，两个平台都是这样（[MAC-QUIT-AI-HOLD](../findings.d/MAC-QUIT-AI-HOLD.md)，待老板决定）。这是现行设计，不判失败。
- Windows DIRECT 租约到期的自动放行曾有安全阻塞（[#1046](https://github.com/raydocs/tono/pull/1046)，文档，已合入）；[#1074](https://github.com/raydocs/tono/pull/1074) 已改成放行前先停核心，W34 验证。
- mihomo（Windows 显式选择时才用的核心）没有保活字段，HY2 仍是 10 秒保活（[HY2-IDLE-MIHOMO](../findings.d/HY2-IDLE-MIHOMO.md)）。Windows 默认已是 sing-box（第 6 节），W19 默认在 sing-box 下做，mihomo 下失败时记录下来，不阻塞。

## 3. 构建

- **Windows**：`main` 上的 `windows-ci.yml` 不产出安装包。未签名候选安装包要靠手动触发 `windows-candidate.yml`（不签名、不发 release、不碰更新通道，产物保留 7 天；[Windows 设备验收](../WINDOWS_0_0_72_DEVICE_ACCEPTANCE.md)用的就是这种包）。**它在 `main` 上目前仍构建不出来**：先前的 `pnpm typecheck` 失败（#837 的 ratchet 在 Windows 上 spawn `tsc` 的问题）已由 `5b106da9` 修掉，但 `main` `56de3c08` 上的 [run 36819512533](https://github.com/raydocs/tono/actions/runs/36819512533) 又失败在后面一步 `pnpm tauri build --bundles nsis`：`tauri-plugin-updater (v2.11.0) : @tauri-apps/plugin-updater (v2.12.0)` 版本不一致（[#1215](https://github.com/raydocs/tono/issues/1215)）。Linux CI 不受影响，所以 `ci-gate` 一直是绿的。先修这一处，再执行 `gh workflow run windows-candidate.yml --ref main`。产物会叫 `tono-windows-0.0.74-candidate-<sha>`，里面有 NSIS 的 `*-setup.exe`、`candidate-manifest.json` 和 `update-target…json`。这个包没有 Authenticode 签名，也没有更新签名。SmartScreen 拦时点「更多信息 → 仍要运行」，不要关掉 SmartScreen。传到测试机后用 `Get-FileHash -Algorithm SHA256` 核对 manifest 里的哈希。
- **macOS**：`main` 上的 `macos-ci.yml` 会上传 `tono-macos-beta-<sha>`（`Tono-macOS-beta.zip`），但它是 `CODE_SIGNING_ALLOWED=NO` 构建的。helper 只认 Team `YY57758GS7` 的 Developer ID 签名，**所以这个 zip 装上也连不上，不能用来测网络。** 有两种办法拿到能用的包：
  1. 在一台装了 Xcode 26 和 `Developer ID Application: Ruirui Wan (YY57758GS7)` 证书的 Mac 上，从 `main` 执行 `tooling/scripts/build-macos-local-verify.sh`（**不加** `--install`，否则会替换这台机器上的 `/Applications/Tono.app`）。产物在 `/tmp/tono-xcode-release/Build/Products/Release/Tono.app`，已签名但没有公证，拷到测试 Mac / VM 后要在「隐私与安全性」里放行，或执行 `xattr -dr com.apple.quarantine /Applications/Tono.app`。
  2. 签名并公证的候选：`macos-release.yml` 带 `candidate_only=true`，但它只接受 `refs/heads/stability/desktop-0.0.74-20260926`，这个分支现在不存在。要先把这个分支建在 `main` 的 SHA 上，再以 `version=0.0.74`、`candidate_only=true` 触发。这会用签名凭据，要老板批准，本 PR 没有触发。
- 应用内的原生更新流程要配对的签名候选（`desktop-update-candidate.yml` / release 线），上面两种包都测不了，见第 7 节。

## 4. macOS

### 连接 / 切换节点

| ID | 类 | 步骤 | 期望结果 | 对应 |
|---|---|---|---|---|
| M1 | VM | 记基线。登录，连一个 VLESS 节点，打开几个国内、国外网站和 claude.ai。依次断开、再连、退出 Tono。 | 首连能用；claude.ai 走出口。断开和退出后 DNS 与基线一致，`pfctl -a tono.killswitch -sr` 为空，`/etc/resolver` 里没有 AI 后缀文件。断开后 `dig claude.ai` 返回真实地址，不是 `198.18.x`（停核心时会刷新 DNS 缓存）。 | [#741](https://github.com/raydocs/tono/pull/741) [#744](https://github.com/raydocs/tono/pull/744) [#1031](https://github.com/raydocs/tono/pull/1031) |
| M2 | VM | 在宿主机或路由器上屏蔽当前出口 IP，再点「连接」。 | 很快失败，不装隧道，普通网络始终能用。提示在同一线路重试，不要求换节点或换网络。 | [#718](https://github.com/raydocs/tono/pull/718) [#720](https://github.com/raydocs/tono/pull/720) |
| M3 | VM（要后台配合） | 连着住宅路由时，在后台把住宅节点同名换 UUID；再在切换 A→B 的过程中轮换 B 的凭据；最后做一次不涉及 A、B 的目录更新。 | 前两种情况核心各重载一次，助手流量走新凭据的住宅出口，PF 放行新端点。无关的目录更新不重载、不断线。 | [#781](https://github.com/raydocs/tono/pull/781) [#802](https://github.com/raydocs/tono/pull/802) |
| M4 | VM（要后台配合） | 连着时在后台改一个托管直连域名，触发策略和 pins 刷新。再做一次：先把运行配置目录设成不可写（或填满磁盘），再触发同样的刷新。 | 可写时照常应用，不掉线。不可写时隧道不断，网页照常加载，界面报错，PF 里原来的会话例外还在。 | [#778](https://github.com/raydocs/tono/pull/778) [#782](https://github.com/raydocs/tono/pull/782) [#950](https://github.com/raydocs/tono/pull/950) [#1039](https://github.com/raydocs/tono/pull/1039) |

### fail-open 与 AI 拦截

| ID | 类 | 步骤 | 期望结果 | 对应 |
|---|---|---|---|---|
| M5 | VM | 连上后执行 `sudo pkill -9 -f sing-box` 杀核心（先用 `pgrep -fl sing-box` 确认），等 1 分钟。之后点「恢复网络」或重连。 | 按第 2 节三点判：约 30 秒内普通网络回来，AI 窄层在。点恢复后窄层消失；重连后正常。 | [#738](https://github.com/raydocs/tono/pull/738) [#1028](https://github.com/raydocs/tono/pull/1028) |
| M6 | VM | 点「连接」，在「连接中」时执行 `pkill -9 -x Tono` 杀 App，不要重开，等 1 分钟。 | 约 30 秒（3 次检查）后 PF 放行，DNS 恢复，AI 窄层在。重开 App 能正常连接。 | [#773](https://github.com/raydocs/tono/pull/773) [#1028](https://github.com/raydocs/tono/pull/1028) |
| M7 | VM | 连上后在宿主机或路由器屏蔽出口 IP，等自愈次数用完。然后解除屏蔽。再屏蔽一次，在后台探测期间点「恢复网络」。 | 次数用完后 PF 放行，普通网络回来，AI 窄层在（#1048），App 不再武装，只在后台探测。解除屏蔽后，TCP 证明通过才自动重连。点了「恢复网络」之后不再自动重连。 | [#720](https://github.com/raydocs/tono/pull/720) [#714](https://github.com/raydocs/tono/pull/714) [#1048](https://github.com/raydocs/tono/pull/1048) [#1043](https://github.com/raydocs/tono/pull/1043) |
| M8 | VM | 连上后在 Chrome 打开「安全 DNS」。另做一次：连着时执行 `sudo pfctl -d`。 | 前者约 1 分钟内断开并提示安全 DNS，网络立刻能用，没有 30 秒空窗。后者 App 在下一次检查时重新武装，微信直连照常，不会永久断网，也不会在 PF 关着时显示「已保护」。 | [#760](https://github.com/raydocs/tono/pull/760) [#761](https://github.com/raydocs/tono/pull/761) |
| M9 | VM（先打快照） | 连上后把 `/Library/Application Support/Tono` 设成只读（或填满磁盘），然后断开。恢复后再连一次，用 `--emergency-disarm` 收尾。 | 两种方式网络都回来，`pfctl -a tono.killswitch -sr` 为空。 | [#761](https://github.com/raydocs/tono/pull/761) [#889](https://github.com/raydocs/tono/pull/889) |
| M10 | VM | 连着时重启虚拟机。 | 开机就有网络，不从 `pf.conf` 装入阻断。App 启动后能恢复会话或正常重连。 | [发布就绪](../RELEASE_READINESS.md)「崩溃、重启、安全模式」 |

### DNS

| ID | 类 | 步骤 | 期望结果 | 对应 |
|---|---|---|---|---|
| M11 | VM | 给在用的网络服务手工设 10 个以上 DNS（含一个 IPv6）。连接，断开；再连接，然后 `pkill -9 -f sing-box`。 | 每次 DNS 都完全恢复成手设的列表，顺序不变，不会留下 `127.0.0.1`。 | [#765](https://github.com/raydocs/tono/pull/765) [#1033](https://github.com/raydocs/tono/pull/1033) [#744](https://github.com/raydocs/tono/pull/744) |

### 睡眠唤醒 / 网络切换

| ID | 类 | 步骤 | 期望结果 | 对应 |
|---|---|---|---|---|
| M12 | 真机 | 连着时合盖睡眠 5 分钟；再睡一晚。 | 唤醒后要么自动恢复连接，要么普通网络能用（AI 窄层可以在）。不会卡在「已保护」却没有网络。 | [#889](https://github.com/raydocs/tono/pull/889) [#1028](https://github.com/raydocs/tono/pull/1028)、[发布就绪](../RELEASE_READINESS.md)（#708） |
| M13 | 真机 | 连着时：换一个 Wi-Fi；关 Wi-Fi 10 秒再开；插拔网线或扩展坞；在 DHCP 慢的网络上重连 Wi-Fi（会短暂拿到 169.254 网关）。 | 只有默认上行真的变了才重建隧道。169.254 空档不算漫游。始终不会永久断网。 | [#835](https://github.com/raydocs/tono/pull/835)、[发布就绪](../RELEASE_READINESS.md)（#702） |

### HY2 / 住宅

| ID | 类 | 步骤 | 期望结果 | 对应 |
|---|---|---|---|---|
| M14 | 真机（家用宽带，不要经过虚拟机 NAT） | 连一个 `· hy2` 节点，空闲 2 分钟、5 分钟各一次，然后打开 claude.ai。 | 不重连就能直接用（sing-box 5 秒保活）。若失败，日志里有 `TONO_CONNECT_HY2_IDLE`，App 在同一线路重试，不要求换节点。若连接前就提示这个 sing-box 构建无法验证 HY2 证书 pin，记录下来并跳过本项。 | [#749](https://github.com/raydocs/tono/pull/749) |
| M15 | 真机（后台挂着） | 用 sing-box alpha.9 核心正常使用 4 小时以上（可与 M12–M14 同时进行）。 | 没有重连循环。日志流不会因为安静而反复重连。 | [#730](https://github.com/raydocs/tono/pull/730) [#1027](https://github.com/raydocs/tono/pull/1027) |

### 更新 / 安装 / 卸载

| ID | 类 | 步骤 | 期望结果 | 对应 |
|---|---|---|---|---|
| M16 | 真机 | 测试 Mac 先装当前发布版并连上。退出后换成本次构建打开。在 helper 升级的管理员提示上先点「取消」，再重试并「允许」。 | 取消后网络能用，`pfctl -a tono.killswitch -sr` 为空，不会等 45 秒才报错。允许后 helper 升级成功，连接正常。 | [#794](https://github.com/raydocs/tono/pull/794) [#759](https://github.com/raydocs/tono/pull/759) [#840](https://github.com/raydocs/tono/pull/840) |
| M17 | 真机 | 连着时退出 Tono，把 `Tono.app` 拖进废纸篓。等 30 秒后执行 `--emergency-reset`。 | 删掉 App 后约 10 秒内 PF 放行。reset 后 `/etc/pf.conf` 里没有 TONO 段，DNS 与基线一致，`/etc/resolver` 里没有 AI 后缀文件。 | [发布就绪](../RELEASE_READINESS.md)「卸载时幂等恢复」 |

## 5. Windows

### 连接 / 切换节点

| ID | 类 | 步骤 | 期望结果 | 对应 |
|---|---|---|---|---|
| W1 | VM | 记基线。连接，浏览，断开，再连，托盘「退出」。另做一次：点「退出」后选「留下」，然后在后台改目录。 | 退出几秒内结束。断开和退出后 DNS 回到基线，没有 `Tono ` 过滤器。选「留下」后，目录改动在正常同步周期内生效。 | [#741](https://github.com/raydocs/tono/pull/741) [#784](https://github.com/raydocs/tono/pull/784) [#1038](https://github.com/raydocs/tono/pull/1038) |
| W2 | VM | 连着时热切换节点，依次 VLESS → HY2 → VLESS。再开很多标签页，热切换后立刻「断开」。 | 延迟和出口 IP 显示属于新节点。HY2 上普通 UDP（视频通话）能用，VLESS 上照旧拒绝。立刻断开时几秒内完成放行。 | [#945](https://github.com/raydocs/tono/pull/945) [#787](https://github.com/raydocs/tono/pull/787) [#783](https://github.com/raydocs/tono/pull/783) |
| W3 | VM | 开住宅路由，选 HY2 出口。打开 Claude、ChatGPT、Gemini 和国内网站。开着微信直连时再开一次 claude.ai。另外连一次和住宅 VLESS 同 IP:443 的 HY2 出口。 | 助手看到的出口 IP 是住宅 IP，没有 QUIC 去云出口。国内站直连，chatgpt.com 和 gemini 走住宅。微信直连开着时 claude.ai 仍走出口。同 IP:443 能连上。 | [#783](https://github.com/raydocs/tono/pull/783) [#797](https://github.com/raydocs/tono/pull/797) [#871](https://github.com/raydocs/tono/pull/871) |
| W4 | VM（要后台配合） | 连着时在后台：(a) 改 `homeProxy` 或换住宅 UUID；(b) 内容不变，只把策略 revision +1 重发，等 2 分钟以上；(c) 目录只加城市。 | (a) 冷重建一次，WFP 保持武装，助手走新住宅。(b) 一直 Connected，TUN 许可不丢，服务日志里没有 Blocked。(c) 不重连。 | [#787](https://github.com/raydocs/tono/pull/787) [#786](https://github.com/raydocs/tono/pull/786) |
| W5 | VM | 账号 A 连接后登出，换账号 B 登录并连接。 | 用的是 B 选中的节点，不会拨 A 的故障转移节点。 | [#874](https://github.com/raydocs/tono/pull/874) |

### fail-open 与 AI 拦截

| ID | 类 | 步骤 | 期望结果 | 对应 |
|---|---|---|---|---|
| W6 | VM | 开着微信直连连上，在任务管理器里结束 `Tono.exe`，等 70 秒。然后重开 App，在显示 Connected 之前就点「退出」。 | 60–70 秒内普通网络回来，DNS 恢复，没有 `Tono ` 过滤器，AI 窄层在（NRPT 和防火墙规则）。马上退出后网络也正常。 | [#777](https://github.com/raydocs/tono/pull/777) [#784](https://github.com/raydocs/tono/pull/784) [#1044](https://github.com/raydocs/tono/pull/1044) |
| W7 | VM | 连上后反复执行 `taskkill /F /IM tono-core.exe`，直到服务不再拉起核心。 | 服务恢复次数用完后放行：普通网络回来，AI 窄层在，不会一直 Blocked。 | [#738](https://github.com/raydocs/tono/pull/738) [#1032](https://github.com/raydocs/tono/pull/1032) [#1021](https://github.com/raydocs/tono/pull/1021) [#1012](https://github.com/raydocs/tono/pull/1012) |
| W8 | VM | 连上后在宿主机或路由器屏蔽出口 IP，等健康监视器放弃，然后解除屏蔽。 | 放弃时普通网络回来，AI 窄层在，只有一次放行。之后后台探测，TCP 证明通过才重连。 | [#714](https://github.com/raydocs/tono/pull/714) [#715](https://github.com/raydocs/tono/pull/715) [#1003](https://github.com/raydocs/tono/pull/1003) [#1010](https://github.com/raydocs/tono/pull/1010) |
| W9 | VM | 全新登录后第一次点「连接」，在「连接中」时禁用虚拟网卡 10 秒再启用，或者结束 `Tono.exe`。 | 不会卡在 Blocked。普通网络回来，AI 窄层在。重开或重试能连上。 | [#1005](https://github.com/raydocs/tono/pull/1005) [#718](https://github.com/raydocs/tono/pull/718) |
| W10 | VM（要后台配合） | 连着时在后台把当前出口从目录里删掉。删完后另选一个节点。 | 一个同步周期内普通网络回来，DNS 恢复，没有 `Tono ` 过滤器，AI 窄层在。界面请用户选节点，不自己重连。选别的节点能正常连上。 | [#791](https://github.com/raydocs/tono/pull/791) [#1036](https://github.com/raydocs/tono/pull/1036) |
| W11 | VM | 连上后执行 `sc stop TonoService`。再连上，直接关机后开机。再连上，重启虚拟机。 | `sc stop` 不报超时；之后网络正常，DNS 恢复，没有 `Tono ` 过滤器，AI 窄层在。关机或重启后开机就有网，不阻断；App 在后台重连，若服务在约 30 秒内重新锁定则保留拦截。 | [#792](https://github.com/raydocs/tono/pull/792) [#902](https://github.com/raydocs/tono/pull/902) [#1014](https://github.com/raydocs/tono/pull/1014) [#740](https://github.com/raydocs/tono/pull/740) [#753](https://github.com/raydocs/tono/pull/753) [#986](https://github.com/raydocs/tono/pull/986) [#1029](https://github.com/raydocs/tono/pull/1029) [#974](https://github.com/raydocs/tono/pull/974) |
| W12 | VM | 连着时以管理员运行开始菜单「Tono — 恢复网络」。先在 App 开着时做一次，再在退出 App 后做一次。 | 记下 App 开着时是否被拒绝（已知：服务握着 owner lock 时会拒绝）。退出后运行一定放行：网络恢复，AI 窄层也被删掉。 | [发布就绪](../RELEASE_READINESS.md)「进程外恢复」 |

### DNS

| ID | 类 | 步骤 | 期望结果 | 对应 |
|---|---|---|---|---|
| W13 | VM | 网卡手工设 IPv4 和 IPv6 DNS（注册表里用空格分隔的列表），对这些服务器开 Windows DoH，Chrome / Edge 开安全 DNS。连接后中途加一块新网卡，然后断开。再连一次，用 W6 的方式杀 App。 | 两次都完全恢复：服务器列表、DoH 标志、浏览器安全 DNS 都和原来一样，新网卡的原始设置也还在。 | [#985](https://github.com/raydocs/tono/pull/985) [#987](https://github.com/raydocs/tono/pull/987) [#989](https://github.com/raydocs/tono/pull/989) [#868](https://github.com/raydocs/tono/pull/868) [#754](https://github.com/raydocs/tono/pull/754) |

### 更新 / 安装 / 卸载

| ID | 类 | 步骤 | 期望结果 | 对应 |
|---|---|---|---|---|
| W14 | 真机 | 测试 PC 上全新安装候选包。连着时再运行一次安装包。断开后再运行一次（修复安装）。 | 全新安装后服务自动运行，不会静默弹出界面，能连上。连着时安装包提示「仍在连接中」并且不做任何改动。断开时修复成功；若要求重启，返回「需要重启」，不报失败。 | [#776](https://github.com/raydocs/tono/pull/776)、installer.nsi |
| W15 | 真机 | 测试 PC 先装当前发布版，用候选安装包覆盖升级，断开状态和已连接状态各做一次。 | 两种状态都升级成功（已连接时按提示先断开）。升级后网络正常，DNS 与基线一致，能连接。文件被占用回滚后重试能成功。 | [#801](https://github.com/raydocs/tono/pull/801) |
| W16 | 真机 | 连着时从「设置 → 应用」卸载 Tono。 | 卸载程序先跑 emergency-disarm。之后没有 `Tono ` 过滤器，NRPT 和防火墙里没有 Tono 规则，DNS 与基线一致，服务被删除。若证明不了已解除，就拒绝删文件并提示用「恢复网络」快捷方式。 | [#1004](https://github.com/raydocs/tono/pull/1004) [#1022](https://github.com/raydocs/tono/pull/1022)、[发布就绪](../RELEASE_READINESS.md)「卸载」 |

### 睡眠唤醒 / 网络切换

| ID | 类 | 步骤 | 期望结果 | 对应 |
|---|---|---|---|---|
| W17 | 真机 | 连着时睡眠 5 分钟；再睡一晚。 | 唤醒后自动恢复连接，或者普通网络能用。不会一直 Blocked。 | [#740](https://github.com/raydocs/tono/pull/740) [#986](https://github.com/raydocs/tono/pull/986) |
| W18 | 真机（有线和 Wi-Fi 都有的笔记本） | 开着微信直连连上，拔网线；换 Wi-Fi；在设置里禁用 Wi-Fi 网卡；1 秒内快速切换两次网络。 | 只重连一次（防抖窗口内的变化顺延，不丢）。DIRECT 不会绑到已断开的网卡上；若所有硬件网卡都断开，就退回全隧道。始终不会永久断网。 | [#878](https://github.com/raydocs/tono/pull/878) [#879](https://github.com/raydocs/tono/pull/879)、[发布就绪](../RELEASE_READINESS.md)（#705） |

### HY2 / 住宅

| ID | 类 | 步骤 | 期望结果 | 对应 |
|---|---|---|---|---|
| W19 | 真机（家用宽带） | 同 M14：连 `· hy2` 节点，空闲 2 分钟、5 分钟各一次，再打开 claude.ai。 | 最好不重连就能用。mihomo 只有 10 秒保活，失败时记录下来（已知缺口），不阻塞发布判断。 | [#749](https://github.com/raydocs/tono/pull/749) |

## 服务端

只在测试服务器或临时 VPS 上做，不要在生产节点上做。

| ID | 类 | 步骤 | 期望结果 | 对应 |
|---|---|---|---|---|
| S1 | VM / 临时 VPS | 用 provisioner 在临时 VPS 上开一个 HY2 节点，然后人为让一次部署失败，触发回滚。 | catalog 源里同时有 DER 指纹和 32 字节的 SPKI pin。客户端能连上这个 `· hy2` 节点。journal 校验不会因为登录横幅误判。回滚后在线文件的权限恢复原样。 | [#995](https://github.com/raydocs/tono/pull/995) [#996](https://github.com/raydocs/tono/pull/996) [#997](https://github.com/raydocs/tono/pull/997) |
| S2 | 预发控制面 | 让一个测试账号连着某节点的 `· hy2`，然后对该节点走下线流程。 | 排空会等这个 HY2 用户；在 cutoff 之前不收回 token。 | [#832](https://github.com/raydocs/tono/pull/832) |

## 开放 issue

| ID | 类 | 步骤 | 期望结果 | 对应 |
|---|---|---|---|---|
| I1 | VM（5 分钟） | 在装了飞书 / Lark 的 Mac 上执行 issue 里的 `codesign -dvv …` 命令。DMG 版和 App Store 版分开记，中文名 `/Applications/飞书.app` 也要看。 | 记下 Identifier、TeamIdentifier、Authority 链和 App 版本，贴回 issue。 | [#422](https://github.com/raydocs/tono/issues/422) |
| I2 | VM | 让 Mac 进入「保护离线」，此时登出再登录，并触发一次策略刷新。 | 记录能否连上控制面。这是以后收紧 PF 例外（改成只允许 `user root`）之前必须先有的设备基线。 | [#331](https://github.com/raydocs/tono/issues/331) |
| I3 | 真机（可选，要两台机器） | 用迁移助理或 Time Machine 把装了 Tono 的 Mac 迁到另一台 Mac，两台都打开 Tono。 | 记录钥匙串项有没有被带过去，两台机器有没有共用同一个设备身份（一台刷新后另一台被登出）。 | [#409](https://github.com/raydocs/tono/issues/409) |

本轮不测：[#602](https://github.com/raydocs/tono/issues/602) 剩下的 TW-OpenAI-1（DHCP 许可没有绑服务 SID）。这是安全研究项，要专门构造绕过，不在这次的几小时里做。

## 6. 本轮新增：Windows 默认内核 sing-box 与夜间合入的 fail-open 修复

**先备份。** 本节每一项开始前，先照第 0 节做：虚拟机打快照，真机做还原点或 Time Machine，用测试账号。改 `Program Files\Tono` 里的文件（`sing-box.exe`、`sing-box-sha256.txt`）之前，先复制一份原件到别处；测完恢复，或直接回滚快照。

基线：`main` `0676435b`（2026-10-01）。本节收的是第 4、5 节写成之后合入的 `needs-hardware` PR：#1061–#1203，加上 #1119 #1121 #1122 #1126 和仍开着的 [#1188](https://github.com/raydocs/tono/pull/1188)。

**规则变了：Windows 默认内核现在是 sing-box（[#1140](https://github.com/raydocs/tono/pull/1140)）。** 所以第 5 节 W1–W19 现在默认在 sing-box 下跑；mihomo 只在显式选择（W21）、预武装自动回退（W22）和下面标明 mihomo 的几项里测。判据只有一条（同第 2 节）：任何失败都退回普通网络、AI 仍拦；只有严格模式才全阻断。

先用的包：同时带 `tono-core.exe`、`sing-box.exe` 和旁边 `sing-box-sha256.txt` 的 Windows 候选包（摘要必须是 `b2e6902ee75d9c4af79df28a61ded67afc4283fc83a44dee8896f3737a4ed027`，alpha.9）。`sing-box.exe` 不在 git 里，要发布机构建。没有这个包就测不了 W20、W23–W28，别用只有 mihomo 的包代替。构建规则见第 3 节。

选内核的本机记录是 App 数据目录下的 `sing-box-core.json`（文件不存在 = sing-box）。明细和对照表见 [Windows 默认核报告](2026-10-01-windows-sing-box-default.md)，审查见 [Claude 审查](2026-10-01-claude-windows-sing-box.md)。

### Windows 默认内核 sing-box

| ID | 类 | 步骤 | 期望结果 | 对应 |
|---|---|---|---|---|
| W20 | VM | 装带 `sing-box.exe` 的候选包，不写 `sing-box-core.json`。连接，浏览，等 1 分钟。执行 `Get-CimInstance Win32_Process -Filter "Name='sing-box.exe'" \| Select-Object ProcessId, CommandLine`，再看 `tono-core.exe` 有没有在跑。断开再连一次，热切换一次节点。 | 跑的是 `sing-box.exe`，参数含 `run -c` 和 `config.json`，没有 `tono-core.exe`。连接不会在约 2 秒后被杀、再重试（#1196：之前 Service 会等 mihomo 的控制器管道，sing-box 永远连不上）。配置里没有 `stack`，也没有 `tcp_fast_open`。断开和热切换都正常。 | [#1140](https://github.com/raydocs/tono/pull/1140) [#1159](https://github.com/raydocs/tono/pull/1159) [#1196](https://github.com/raydocs/tono/pull/1196) |
| W21 | VM | 写 `{"schema":2,"device_id":"<installation_id>","core":"mihomo"}` 到 `sing-box-core.json` 再连接。断开，换成 schema 1 的 `{"sing_box_core":false,...}` 再连。再断开，把 `device_id` 改成别的值再连。最后删掉文件再连。 | 前两次跑 `tono-core.exe`（mihomo）。`device_id` 不是本机的那次，以及删文件后，都回到 sing-box。mihomo 路径下 W1、W7 仍然通过。 | [#1140](https://github.com/raydocs/tono/pull/1140) |
| W22 | VM | 断开状态下（WFP 没武装）：(a) 把 `Program Files\Tono\sing-box.exe` 改名挪走；(b) 恢复后，改 `sing-box-sha256.txt` 的一个字符。每次都点连接。每次测完恢复原件。 | 两次都在武装前自动改跑 mihomo，能连上，普通网络在，AI 仍拦。日志里能看到回退原因（缺失 / 摘要对不上）。**只有这一步会发生自动回退。** | [#1140](https://github.com/raydocs/tono/pull/1140) |
| W23 | VM | 默认 sing-box 连着时：(a) 把 `sing-box-core.json` 写成 mihomo，不要断开，等 2 分钟；(b) 连着时 `taskkill /F /IM sing-box.exe`，反复几次；(c) 保护离线（把出口屏蔽到健康监视器放弃）后解除屏蔽，让它自动重连。 | 武装期间不换核：(a) 仍是 `sing-box.exe`，直到断开重连才变；(b) 失败时放行普通网络、AI 仍拦，**不会改去启动 mihomo**，也不会一直 Blocked；(c) 重连后仍是 sing-box。已知边角：(c) 在保护离线下是否会误换核，见 [#1197](https://github.com/raydocs/tono/issues/1197)，看到换核就记录，别当通过。 | [#1140](https://github.com/raydocs/tono/pull/1140) [#1196](https://github.com/raydocs/tono/pull/1196) |
| W24 | VM（两个包） | 用协议 18 的构建（取含 [#1159](https://github.com/raydocs/tono/pull/1159) 的 main 点）和当前协议 19 的构建（含 [#1175](https://github.com/raydocs/tono/pull/1175)）混搭，在快照里装：(a) 18 的 Service + 19 的 App；(b) 19 的 Service + 18 的 App；(c) 19 的 Service + 更旧的 App（协议 ≤ 17）。每种都：连接，断开，点「恢复网络」。 | (a) 能连，sing-box 保持全隧道，不做按进程直连，普通网络正常。(b) 能连，同上。(c) 旧 App 仍能释放 WFP（断开和「恢复网络」有效）。Service 低于协议 18 又有 sing-box 时，App 拒绝连接并提示，**不偷偷改跑 mihomo**；没有 sing-box 时回退 mihomo。不允许出现断网。 | [#1140](https://github.com/raydocs/tono/pull/1140) [#1175](https://github.com/raydocs/tono/pull/1175) [#1196](https://github.com/raydocs/tono/pull/1196) |
| W25 | VM | 默认 sing-box + 协议 19，开着微信（或别的已审应用）直连连上。用 `Get-NetTCPConnection -OwningProcess (Get-Process <应用>).Id` 或资源监视器看该应用的连接；同时对 claude.ai 做 `curl`；整个过程在另一个窗口持续 `ping -t` 国内地址。再连着时把策略 revision +1 重发一次（W4(b) 的做法）。 | 已审应用的流量走物理网卡（DIRECT），其余走出口，claude.ai 仍被拦。换进程这几秒 `ping` 不断；失败时留在全隧道（不是 Blocked），实在证明不了隧道才放行普通网络，AI 仍拦。协议 18 的 Service 上没有 DIRECT，只有全隧道。 | [#1175](https://github.com/raydocs/tono/pull/1175) |
| W26 | VM | 在 sing-box 下整套重做 fail-open：W6、W7、W8、W9、W10、W11、W12。 | 每一项的期望都和第 5 节一样：普通网络回来、AI 窄层在、没有 `Tono ` 过滤器。W7 里杀的是 `sing-box.exe`（不是 `tono-core.exe`）。**一项都不能因为内核不同而降级。** | [#1140](https://github.com/raydocs/tono/pull/1140) |
| W27 | VM | 默认 sing-box 下重做 W3（住宅 + HY2 + 助手域名）和国内模型 API：`curl -s https://dashscope.aliyuncs.com`、同域其他子域，以及一个普通 `aliyuncs.com` 站点，看各自出口。 | 住宅和助手域名规则与 mihomo 一致。DashScope 模型 API 走出口，不被 `aliyuncs.com` 的 DIRECT 抢走；普通 `aliyuncs.com` 站点仍可直连。 | [#1140](https://github.com/raydocs/tono/pull/1140) [#1084](https://github.com/raydocs/tono/pull/1084) |
| W28 | VM（要开发者在场） | Service 只准许自己生成的 sing-box 运行配置。正常路径：默认 sing-box 连上，Service 日志里没有准入拒绝。拒绝路径：开发者在隔离虚拟机里，在 Service 启动 sing-box 之前，把生成的配置分别改成：加远程 rule-set；`inbounds` 监听 `0.0.0.0`；`route.final` 改成 `direct`；加文件路径键或 socket mark；`insecure: true`。 | 正常路径一次连上。每个被改动的配置都被 Service 拒绝启动，并按失败处理（放行普通网络、AI 拦）。**[#1188](https://github.com/raydocs/tono/pull/1188) 合入前这一项不能判通过**；没有注入入口时，只验证正常路径，拒绝路径记为「由 CI 准入测试覆盖」。DIRECT 出站能收哪些规则是另一个缺口，见 [#1204](https://github.com/raydocs/tono/issues/1204)。 | [#1188](https://github.com/raydocs/tono/pull/1188) [#1140](https://github.com/raydocs/tono/pull/1140) |
| W29 | 真机（有跨洋出口） | 在出口 RTT 不低于 150 ms 的节点上，用 mihomo（W21 的做法显式选）和 sing-box 各测一次下载吞吐（`iperf3` 或大文件，单连接 30 秒）。mihomo 要先换成 `gvisor-adaptive.2` 内核：`windows-core` 重编并发布之前，装的还是 `gvisor-adaptive.1`（窗口 128 KiB），这一项只记「未测」。 | `gvisor-adaptive.2` 的 mihomo 单连接吞吐明显高于 `.1`（PR 里 150 ms 回环模拟：7.0 → 110.1 Mbps；真机数字只记录，不按这个数判）。sing-box 的数字和 macOS 同量级。路由、证书校验、AI 规则、失败放行都不变。 | [#1119](https://github.com/raydocs/tono/pull/1119) [#1140](https://github.com/raydocs/tono/pull/1140) |
| W30 | 真机 | 连接后用浏览器打开一个新域名，同时在物理网卡上抓包（只看有没有往外的明文 DNS）。然后在出口节点上屏蔽客户端到 `1.1.1.1:443` 的流量，再解析一个新域名。分别在 sing-box 和显式 mihomo 下做。 | 主用 DoH 通时只有一次 Reality 握手去查 DNS（出口节点日志里主用方向有请求、备用方向没有）。物理网卡上没有出站明文 DNS。主用被屏蔽后备用 DoH 仍然答得回来，只多约 40 ms，不是数秒超时。 | [#1121](https://github.com/raydocs/tono/pull/1121) [#1140](https://github.com/raydocs/tono/pull/1140) |
| W31 | 真机 | 连接，一看到 Connected 就立刻打开一个新网站，量首字节时间（浏览器开发者工具）。再看界面上的延迟数字什么时候出现。另做一次：让出口数据面故障（屏蔽出口 IP）后点连接，看失败诊断。分别在 sing-box 和显式 mihomo 下做。 | Connected 不等延迟探测。首字节没有被探测拖慢。延迟数字在连上约 1.5 秒后才出现。数据面没过时，失败诊断仍立即探测，不等 1.5 秒；失败时放行普通网络、AI 仍拦。 | [#1122](https://github.com/raydocs/tono/pull/1122) [#1140](https://github.com/raydocs/tono/pull/1140) |
| W32 | 真机 | 测试 PC 先装不带 `sing-box.exe` 的旧候选，再用带它的候选覆盖升级；另一次全新安装；最后在连着时卸载。每次用 `Get-FileHash -Algorithm SHA256 'C:\Program Files\Tono\sing-box.exe'` 对 `sing-box-sha256.txt`。 | `sing-box.exe` 和 `sing-box-sha256.txt` 与 Service、`tono-core.exe`、App 一起装好；摘要等于上面那个 alpha.9 值。文件被占用导致回滚时，新引入的 `sing-box.exe` 被删除（不是编一份旧文件），其余成员恢复原样。卸载后 `sing-box.exe` 也被删除。pin 已设置但 staged 文件缺失或摘要不符的包，升级被拒绝（要定制包，没有就记「未测」）。原生（应用内）更新走第 7 节。 | [#1159](https://github.com/raydocs/tono/pull/1159) |
| W33 | 预发控制面 + VM | 在预发目录里放三个测试出口：(a) VLESS 节点省略 `client-fingerprint`；(b) 节点名带方括号，如 `Tokyo [primary]`（旧目录里留下的名字）；(c) 有 `· hy2` 的出口，带和不带 SPKI 各一个。选另一个正常节点连接，再依次选这些节点。sing-box 和显式 mihomo 各做一遍。 | 没被选中的节点不会让整个目录编译失败：选正常节点一定能连。(a)(b) 被选中时也能连上。(c) 带 SPKI 的 HY2 能连；没有 SPKI 的 HY2 在 sing-box 下被标为不可用，不让整个连接失败。 | [#1157](https://github.com/raydocs/tono/pull/1157) [#1148](https://github.com/raydocs/tono/pull/1148) [#1140](https://github.com/raydocs/tono/pull/1140) |

W19（HY2 空闲保活）现在默认在 sing-box 下做；mihomo 只有 10 秒保活的已知缺口，仍只在显式选 mihomo 时记录。

### Windows fail-open / 恢复补充

以下全部按第 2 节的三点判（普通网络回来、AI 窄层在、点「恢复网络」后窄层删掉）。默认内核 sing-box。

| ID | 类 | 步骤 | 期望结果 | 对应 |
|---|---|---|---|---|
| W34 | VM | 开着微信直连连上，结束 `Tono.exe`，等 DIRECT 租约到期（W6 的 60–70 秒），再看进程、网卡和 DNS。另做一次：开启直连发现后 20 秒内断开并立刻重连，看新会话的 DIRECT。 | 租约到期的放行会先停核心：`sing-box.exe` 不在了，TUN 网卡没了，DNS 正常解析（没有核心留下的 53 端口拦截）。普通网络回来，AI 窄层在。快速断开重连时，旧会话迟到的失败不会清掉新会话的 DIRECT。 | [#1074](https://github.com/raydocs/tono/pull/1074) [#1116](https://github.com/raydocs/tono/pull/1116) [#926](https://github.com/raydocs/tono/pull/926) |
| W35 | VM | 让系统自动放行（W7 杀核心到恢复次数用完），随后：(a) 在循环里持续 `curl -m 3 -sI https://claude.ai`；同一时刻再触发一次同样的放行（再杀核心、或 Service 重启）；(b) 把 Windows 装在 D: 的虚拟机上做一次放行，看 `Get-NetFirewallRule -DisplayName 'Tono selective*'`。 | (a) 循环里一次都不应成功：刷新 AI 窄层不能有「先删后加」的空窗。(b) 非 C 盘的系统上，Anthropic IP 防火墙规则也装上，直连 IP 也被拦（不只是 NRPT 域名）。 | [#1087](https://github.com/raydocs/tono/pull/1087) [#1089](https://github.com/raydocs/tono/pull/1089) |
| W36 | VM | 自动放行后（AI 窄层在），重开 App，让账号读取超过 8 秒（断开账号网络访问几秒），在登录前出现的界面点「恢复网络」。另做一次：自动放行进行到一半时立刻点「断开」，等 1 分钟。再做一次：放行完成后 `sc stop TonoService`，随后强杀 Service 进程，再启动。 | 前两次：AI 防火墙和 NRPT 规则最终都被删掉（用户明确要求恢复，优先于自动保留）。第三次：重启 Service 后 AI 窄层仍在，不会被忘掉。 | [#1112](https://github.com/raydocs/tono/pull/1112) [#1142](https://github.com/raydocs/tono/pull/1142) [#1147](https://github.com/raydocs/tono/pull/1147) |
| W37 | VM | 出口 TCP 能连但握手失败（出口节点上停 Xray，改用 `socat` 在 443 空监听）。点连接，观察自动重连至少 5 分钟；然后恢复出口。另做一次：失败重连期间用户改选另一个健康节点；再做一次：这样的连接超时后（可让 Windows 睡眠 5 分钟后唤醒）。 | 重连尝试的间隔逐步变长，不会每 2 秒武装一次又释放（日志看间隔）。期间普通网络在、AI 仍拦。改选的节点不会被先前节点的 TCP 证明盖掉。睡眠唤醒后仍有后台恢复在跑，出口恢复后自动重连。 | [#1106](https://github.com/raydocs/tono/pull/1106) [#1138](https://github.com/raydocs/tono/pull/1138) [#1098](https://github.com/raydocs/tono/pull/1098) |
| W38 | VM（要后台配合） | 连着时 (a) 改住宅 UUID，并在 App 还在「连接中」时发生（可先让连接慢一点）；(b) 做 HY2 → VLESS 冷切换，并等 60 秒让 TCP 证明缓存过期；(c) 换住宅路由期间不要碰 App。 | 连上之后用的是新住宅，不是连接开始时的旧凭据。冷切换在受保护状态下能一次连上，不会停在断开等人手点。 | [#1066](https://github.com/raydocs/tono/pull/1066) [#1070](https://github.com/raydocs/tono/pull/1070) |
| W39 | VM（要后台配合） | 连着出口 A，用 `netsh` 或路由器把 A 的数据面封掉，使健康检查开始失败；在检查窗口内立刻热切到 B。另做一次：在 Service 状态读取被拖慢时点「退出」弹框，弹框开着的时候让新的连接成功。 | B 不被上一轮对 A 的健康失败误释放：连接保持，延迟和出口 IP 属于 B。退出弹框取消后，新连接的状态不被旧快照重置。 | [#1133](https://github.com/raydocs/tono/pull/1133) [#1150](https://github.com/raydocs/tono/pull/1150) [#1111](https://github.com/raydocs/tono/pull/1111) |
| W40 | VM | 断开时用 PowerShell 占住 `protected-dns.json`（`$f=[IO.File]::Open($path,'Open','Read','None')`，路径以 Service 日志为准），然后断开；断开期间把网卡 DNS 手工改成新值；解除占用；再连再断。 | 断开成功。最终 DNS 是你刚改的新值，不会被旧会话的旧值覆盖回去。 | [#1076](https://github.com/raydocs/tono/pull/1076) |

### macOS 补充

| ID | 类 | 步骤 | 期望结果 | 对应 |
|---|---|---|---|---|
| M18 | VM | 连着住宅会话时分别触发：(a) 在 Chrome 里开「使用安全 DNS」；(b) 后台把当前出口从目录里删掉（同 W10）；(c) 后台轮换住宅凭据，并在重载进行中 `sudo kill` sing-box 进程。每次放行后执行 `curl -m 10 -sI --resolve claude.ai:443:160.79.104.1 https://claude.ai` 和 `netstat -rn \| grep 160.79.104`。 | 三种都：普通网络回来，PF 为空，AI 窄层在（`/etc/resolver/claude.ai` 存在；直接 IP 请求失败；黑洞路由带网关）。不应只开通普通网络而把 AI 一并放掉。 | [#1061](https://github.com/raydocs/tono/pull/1061) [#1103](https://github.com/raydocs/tono/pull/1103) [#1146](https://github.com/raydocs/tono/pull/1146) [#1110](https://github.com/raydocs/tono/pull/1110) |
| M19 | VM（要后台配合） | 连着，国内站走 DIRECT。后台发布：(a) 撤销该 DIRECT 授权的新策略；(b) 在节点切换进行中再发一次撤销；(c) 目录里同时删掉当前选中的 A 和正在切换的 B、保留 C。 | (a) 不重连，会话保持，该域名随即不再走物理网卡（看出口 IP）。(b) 切换结束后撤销仍然生效，不会被先前计划恢复。(c) 最终稳定在 C，不会被迟到的切换结果改回 A 或 B。 | [#1115](https://github.com/raydocs/tono/pull/1115) [#1149](https://github.com/raydocs/tono/pull/1149) [#1153](https://github.com/raydocs/tono/pull/1153) [#1158](https://github.com/raydocs/tono/pull/1158) |
| M20 | VM | 先备份，再自建一个 `/etc/resolver/openai.com`（自定义内容）并给系统装一个别的产品用的 `127.0.0.1` DNS 服务。连接，断开；再连接并强杀 App（W6 的方式），等恢复。 | 自建的 `/etc/resolver/openai.com` 恢复成原内容、原权限，不被删；别的产品的 `127.0.0.1` DNS 设置保留；Tono 自己的 sinkhole 文件被清理。 | [#1141](https://github.com/raydocs/tono/pull/1141) [#1154](https://github.com/raydocs/tono/pull/1154) |
| M21 | 真机（USB 网卡） | 连着，默认出口是 `en0`；插入第二块 USB 以太网卡（`en0` 仍是默认）。看 `sudo pfctl -a tono.killswitch -sr`，并从新网卡所在的局域网解析一个域名。另做一次：A 出口被屏蔽、B 健康，让它走无保护的后台恢复。 | 新网卡的局域网 DNS / DoT 也在 PF 作用域内，不绕过；已存在的会话许可不被撤销。后台恢复会连上被证明可用的 TCP 出口（B），不会反复重连已证明失败的 A，且间隔逐步变长。 | [#1135](https://github.com/raydocs/tono/pull/1135) [#1086](https://github.com/raydocs/tono/pull/1086) |
| M22 | VM | 在 M16 的 helper 升级窗口里，同时点「修复 helper」（管理员修复）。另做一次：复制一份 `Tono.app`，用 `mkfifo` 把内嵌 helper 或 Core 换成命名管道，再触发升级。 | 重叠操作之后 helper 仍在，PF 不会停在有规则没守护。FIFO 包被拒绝并报错，界面不挂起，Core 被停掉的话会正常恢复。 | [#1130](https://github.com/raydocs/tono/pull/1130) [#1166](https://github.com/raydocs/tono/pull/1166) |
| M23 | 真机 | 同 W31：连接后立刻开新页，量首字节；看延迟数字何时出现；让数据面故障后连接，看失败诊断。 | 首字节没被探测拖慢，延迟数字约 1.5 秒后出现。失败诊断仍立即探测，健康检查不受影响；失败时放行普通网络、AI 仍拦。 | [#1126](https://github.com/raydocs/tono/pull/1126) |
| M24 | VM | 同 W27 的国内模型 API 一项：`curl -s https://dashscope.aliyuncs.com` 和同类 Qwen 模型域名，以及一个普通 `aliyuncs.com` 站点。 | 模型 API 走出口；普通 `aliyuncs.com` 站点仍直连。 | [#1084](https://github.com/raydocs/tono/pull/1084) |

### 服务端补充

只在预发控制面和临时 VPS 上做。

| ID | 类 | 步骤 | 期望结果 | 对应 |
|---|---|---|---|---|
| S3 | 预发控制面 | 用两个管理员会话抢跑：(a) 对一个节点下线，同时马上重新上架（relist）；(b) 对一个节点退役，同时给用户分配该节点作住宅出口；(c) 退役 / 更换住宅出口，同时给另一个用户做同样的绑定。 | (a) 重新上架后节点的出口 token 没有被旧的退役清理禁用。(b)(c) 不会出现绑定指向已退役节点；客户端目录不会因此 503。 | [#1080](https://github.com/raydocs/tono/pull/1080) [#1170](https://github.com/raydocs/tono/pull/1170) [#1203](https://github.com/raydocs/tono/pull/1203) |
| S4 | 预发控制面 + VM | 把一个同时有 Reality 和 HY2 的节点退役，重新激活其出口身份，再整块上架。读目录，再让客户端连它的 `· hy2`。 | 目录里 HY2 同时有 DER 指纹和 SPKI pin，客户端能连。 | [#1167](https://github.com/raydocs/tono/pull/1167) |

## 7. 暂缓：要签名配对候选才能测

应用内原生更新要更新签名和配对的 release sequence。第 3 节的两种包都没有，所以这些 PR 本轮无法在设备上走通。它们都有 CI 回归测试；等签名候选出来后单独补一轮：

- **macOS 原生更新**：[#971](https://github.com/raydocs/tono/pull/971)（更新失败放行时恢复 DNS 并装 AI 层）[#891](https://github.com/raydocs/tono/pull/891) [#991](https://github.com/raydocs/tono/pull/991) [#993](https://github.com/raydocs/tono/pull/993) [#785](https://github.com/raydocs/tono/pull/785)（已合入：断开并重试先发布已验证的断开）[#1001](https://github.com/raydocs/tono/pull/1001)（已合入：放行前结束唤醒恢复）[#1064](https://github.com/raydocs/tono/pull/1064)（执行器清理失败不丢重试）[#1099](https://github.com/raydocs/tono/pull/1099)（更新恢复中的失败保留 AI 层）；[#795](https://github.com/raydocs/tono/pull/795) 仍开着。
- **Windows 原生更新**：[#779](https://github.com/raydocs/tono/pull/779) [#793](https://github.com/raydocs/tono/pull/793) [#1007](https://github.com/raydocs/tono/pull/1007) [#1040](https://github.com/raydocs/tono/pull/1040)（Prepare 失败后放行并保留 AI 层）、[#858](https://github.com/raydocs/tono/pull/858) [#961](https://github.com/raydocs/tono/pull/961) [#1042](https://github.com/raydocs/tono/pull/1042) [#978](https://github.com/raydocs/tono/pull/978)（执行器起不来、目标服务起不来、回滚后放行）、[#844](https://github.com/raydocs/tono/pull/844) [#772](https://github.com/raydocs/tono/pull/772) [#911](https://github.com/raydocs/tono/pull/911) [#1017](https://github.com/raydocs/tono/pull/1017) [#1025](https://github.com/raydocs/tono/pull/1025) [#824](https://github.com/raydocs/tono/pull/824)（采纳、清理、恢复任务）、[#1075](https://github.com/raydocs/tono/pull/1075)（恢复任务注册失败、后继创建失败后放行）、[#1155](https://github.com/raydocs/tono/pull/1155)（回滚收尾被打断）、[#1163](https://github.com/raydocs/tono/pull/1163)（启动用户令牌捕获被拒）、[#1168](https://github.com/raydocs/tono/pull/1168)（发布后恢复的进程起点下限）、[#1172](https://github.com/raydocs/tono/pull/1172)（消费状态写失败）。
- **Windows 带 `sing-box.exe` 的原生更新**：[#1159](https://github.com/raydocs/tono/pull/1159) 的第四个成员在应用内更新（含更新清单里可省略的 `singBoxSha256`、pin 缺失或不符时拒绝升级）也要走一遍，等签名候选。
- 补测要点（取自这些 PR）：连着时让更新准备失败（例如拒绝写更新暂存目录），应当报错，然后从「保护离线」变成「未连接」，网络能用，DNS 恢复，没有 `Tono ` 过滤器，AI 窄层在；正常更新流程不变；连续更新两次，第二次前会清掉上一次的备份。

## 附录 A：CI 已覆盖，本轮不单独测

这些 PR 都有 CI 回归测试。它们的故障点（BFE 卡死、互斥锁中毒、PID 复用、注册表回调时序、竞态等）在设备上没法安全或稳定地人为触发，或者只改了显示。它们的正常路径已经由上面的主线条目顺带走到。

- 只改显示或日志：[#722](https://github.com/raydocs/tono/pull/722) 阶段计时键；[#762](https://github.com/raydocs/tono/pull/762) 住宅路由提交后重启日志流；[#799](https://github.com/raydocs/tono/pull/799) WebSocket 停滞标记；[#885](https://github.com/raydocs/tono/pull/885) 健康检查不清无关报错；[#942](https://github.com/raydocs/tono/pull/942) 健康监视器不写回过期快照。
- macOS 竞态与边界：[#774](https://github.com/raydocs/tono/pull/774) 系统代理管理员提示超时；[#788](https://github.com/raydocs/tono/pull/788) 旧 sidecar 标记的 PID 复用；[#836](https://github.com/raydocs/tono/pull/836) `/etc/resolver` 读不出；[#882](https://github.com/raydocs/tono/pull/882) 取消的隧道等待；[#1030](https://github.com/raydocs/tono/pull/1030) DNS 锁争用不挂起。
- Windows 服务内部健壮性：[#769](https://github.com/raydocs/tono/pull/769) StartClash 失败、墓碑写失败、快照删不掉时都放行；[#775](https://github.com/raydocs/tono/pull/775) 坏的运行记录；[#807](https://github.com/raydocs/tono/pull/807) WebSocket 握手超时；[#812](https://github.com/raydocs/tono/pull/812) 中毒的互斥锁；[#828](https://github.com/raydocs/tono/pull/828) DNS 回调生命周期；[#841](https://github.com/raydocs/tono/pull/841) DNS 自写窗口；[#866](https://github.com/raydocs/tono/pull/866) 停不掉核心时放回隧道 DNS；[#873](https://github.com/raydocs/tono/pull/873) 未记录的核心；[#912](https://github.com/raydocs/tono/pull/912) [#933](https://github.com/raydocs/tono/pull/933) SCM 读取超时与线程上限；[#923](https://github.com/raydocs/tono/pull/923) 特权助手超时；[#929](https://github.com/raydocs/tono/pull/929) StartClash 期间读日志；[#955](https://github.com/raydocs/tono/pull/955) 已接受的服务关闭；[#1024](https://github.com/raydocs/tono/pull/1024) 过期崩溃记录重试；[#1037](https://github.com/raydocs/tono/pull/1037) 新武装证明。
- Windows 进程身份校验：[#994](https://github.com/raydocs/tono/pull/994) [#999](https://github.com/raydocs/tono/pull/999)，核心 PID 与身份。
- Windows 连接流程：[#757](https://github.com/raydocs/tono/pull/757) 微信签名路径变化；[#884](https://github.com/raydocs/tono/pull/884) 连接预算；[#898](https://github.com/raydocs/tono/pull/898) 恢复时取消卡住的 DIRECT 重载；[#900](https://github.com/raydocs/tono/pull/900) 过期签名路径；[#917](https://github.com/raydocs/tono/pull/917) 拒绝不走 TUN 的 YAML；[#925](https://github.com/raydocs/tono/pull/925) 系统代理清理；[#1045](https://github.com/raydocs/tono/pull/1045) 启动恢复期间的交互登录。
- Windows AI 窄层的边角（主路径在 W6–W11 里看）：[#976](https://github.com/raydocs/tono/pull/976) WFP 安装失败时保留；[#983](https://github.com/raydocs/tono/pull/983) 放行重试时保留；[#988](https://github.com/raydocs/tono/pull/988) 超时后的修改顺序。
- 服务端：[#1009](https://github.com/raydocs/tono/pull/1009) exit-agent 撤销清单（Services CI）。
- 第 6 节补充的 CI 已覆盖项（故障点设备上无法安全或稳定触发）：[#1065](https://github.com/raydocs/tono/pull/1065) exit-agent 静态校验超时保留清单；[#1090](https://github.com/raydocs/tono/pull/1090) SCM Stop 时 owner 状态写失败仍放行；[#1136](https://github.com/raydocs/tono/pull/1136) 自动放行中 helper 死亡后续接 AI 层；[#1144](https://github.com/raydocs/tono/pull/1144) 无快照时 DNS 激活失败；[#1178](https://github.com/raydocs/tono/pull/1178) pins 刷新后 utun 起不来；[#1156](https://github.com/raydocs/tono/pull/1156) 迟到的成功放行后恢复所有者；[#1075](https://github.com/raydocs/tono/pull/1075) [#1155](https://github.com/raydocs/tono/pull/1155) [#1163](https://github.com/raydocs/tono/pull/1163) [#1168](https://github.com/raydocs/tono/pull/1168) [#1172](https://github.com/raydocs/tono/pull/1172) Windows 更新失败路径（设备走法在第 7 节）；[#1105](https://github.com/raydocs/tono/pull/1105) 已关闭。
- 严格模式全阻断：两个平台都没有生产开关，相关分支由各 PR 的单测覆盖。

## 附录 B：未合入，暂不测

截至 `0676435b` 仍开着的 `needs-hardware` PR。合入之后，把对应的项补进下一版清单。

| PR | 平台 | 内容 | 合入后要测 |
|---|---|---|---|
| [#352](https://github.com/raydocs/tono/pull/352) | Win | 服务保护路由绑定已安装的 App 镜像 | 合入前就要设备证据：`icacls "C:\Program Files\Tono"` 和属主 |
| [#663](https://github.com/raydocs/tono/pull/663) | Win | 受保护的 TUN 路由最多等 20 秒 | 慢机器首连 |
| [#763](https://github.com/raydocs/tono/pull/763) | mac | 紧急解除不受过期核心影响；启动失败恢复 DNS；FIFO 输入不挂起 | 删用户场景；把 config.json 换成 FIFO 后连接 |
| [#795](https://github.com/raydocs/tono/pull/795) | mac | 「保护离线」时原生更新能提交 | 原生更新（要签名） |
| [#1188](https://github.com/raydocs/tono/pull/1188) | Win | Service 只准许产品 sing-box 运行配置 | W28，合入前不能判通过 |

原附录 B 里这之后已合入的 PR，测试落点（没有单独的新步骤）：[#785](https://github.com/raydocs/tono/pull/785) [#1001](https://github.com/raydocs/tono/pull/1001) → 第 7 节（要签名）；[#798](https://github.com/raydocs/tono/pull/798) → W37；[#867](https://github.com/raydocs/tono/pull/867) → W3 的 macOS 版；[#886](https://github.com/raydocs/tono/pull/886) → 首连 DNS 审计（M 系列 DNS 项）；[#926](https://github.com/raydocs/tono/pull/926) → W34；[#930](https://github.com/raydocs/tono/pull/930) → W11；[#958](https://github.com/raydocs/tono/pull/958) → 国内站直连；[#963](https://github.com/raydocs/tono/pull/963) → M18(b)、M19(c)；[#966](https://github.com/raydocs/tono/pull/966) → M4、M19；[#979](https://github.com/raydocs/tono/pull/979) → M16、M22；[#982](https://github.com/raydocs/tono/pull/982) → W13；[#1046](https://github.com/raydocs/tono/pull/1046)（文档）→ W34；[#1047](https://github.com/raydocs/tono/pull/1047) → W5。

已关闭、不测：[#827](https://github.com/raydocs/tono/pull/827)、[#856](https://github.com/raydocs/tono/pull/856)、[#1105](https://github.com/raydocs/tono/pull/1105)、[#887](https://github.com/raydocs/tono/pull/887)（已由 #858 修掉）、[#937](https://github.com/raydocs/tono/pull/937)（由 #942 取代）、[#944](https://github.com/raydocs/tono/pull/944)（由 #945 取代）。

## 记录方式

每项记：构建 SHA 和安装包哈希、OS 版本、开始和结束时间、实际结果、截图或日志位置。没做的写「未测」，不要写「通过」（[Windows 设备验收 §5](../WINDOWS_0_0_72_DEVICE_ACCEPTANCE.md)）。日志和抓包放私有位置，不要贴进公开仓库。
