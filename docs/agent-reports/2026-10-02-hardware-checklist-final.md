# 实机测试最终清单（0.0.74 候选，2026-10-02）

给测试的静杰，也给老板看。macOS 和 Windows 两个候选从同一个 `main` 构建，按这一份测。只收必须在设备上跑的项，重复的已合并，按流程分组，不按 PR 逐个测。取代 [2026-10-01 清单](2026-10-01-hardware-checklist.md)。

## 候选与总量

- macOS 候选：`Tono-0.0.74-build74-arm64.zip` sha256 `2818754d79098500bc7aa32cb2d06c4e048bf12e7826ce29ca5430748c69047d`（Developer ID 签名 + 公证，未 Sparkle 签名；[run 36943270858](https://github.com/raydocs/tono/actions/runs/36943270858)，artifact `Tono-0.0.74-build74-arm64`）。包内 `Tono` `467b3393…`，`tono-core-helper` `08235ca7…`，`sing-box` `5208f09b…`（签名后）。
- Windows 候选：`Tono_0.0.74_x64-setup.exe` sha256 `34e2603281ba4029f4b88d7a6e0bf070520c5d94679e079ccad2c15f50150b50`（未 Authenticode 签名、未 updater 签名，SmartScreen 会拦，选“仍要运行”；[run 36943273462](https://github.com/raydocs/tono/actions/runs/36943273462)，artifact `tono-windows-0.0.74-candidate-36e3194d…`）。包内 `tono-service.exe` `fdbafedc…`，`tono-core` `9d5c6f1d…`，sing-box 为 alpha.9 `b2e6902e…`。
- 源码 `main`：`36e3194d0f77bd9b792450423fc47b0f2cfccbe1`（两个候选同一个 SHA；含 #1297 #1302 #1311 #1312）
- macOS helper 协议版本应为 `4.52.36`（候选含 [#1302](https://github.com/raydocs/tono/pull/1302)）。Windows 包里必须有 `sing-box.exe` 和 `sing-box-sha256.txt`（摘要 `b2e6902ee75d9c4af79df28a61ded67afc4283fc83a44dee8896f3737a4ed027`，alpha.9）。
- 来源：2026-10-01 清单的全部条目（基线 `0676435b`），加上之后合入的全部 `needs-hardware` PR：#352 #663（经 #1243 移到 main）#763 #795 #1188 #1216 #1220 #1222 #1226 #1227 #1232 #1237 #1243 #1244 #1245 #1248 #1253 #1257 #1263 #1266 #1267 #1268 #1272 #1275 #1278 #1281 #1283 #1285 #1289 #1295 #1306，以及 #1297 #1302（均已合入候选）。判据：[决策 031](../decisions/031-2026-09-30-fail-open-keeps-ai-block.md)、[决策 044](../decisions/044-2026-10-01-macos-paused-states-release.md)。
- 标记：**[VM]** 虚拟机可测（macOS 用 UTM / Parallels 的 macOS 客户机；Windows 用 **x64** 虚拟机，Apple Silicon 上的 Windows ARM 虚拟机跑 x64 TUN 驱动不可靠，结果不算数）。**[真机]** 必须真机：真实网卡、Wi-Fi、睡眠唤醒、真实安装 / 升级 / 卸载、家用宽带。「要后台配合」= 需要有人在预发控制面改目录或策略；「开发在场」= 需要开发做故障注入。
- **总数：45 项。[VM] 33 项，[真机] 12 项。** 其中 E1、E2 要配对的签名候选和测试更新源，没有就整组记「未测」；E3 要开发在场。
- 时间估计：VM 部分约 4 小时；真机部分约 3 小时，另加 D5 的 4 小时浸泡（可与其他真机项同时挂着）和 D1 / D3 的一晚睡眠。

## 0. 先备份（必须先做）

1. **不要在主力工作机上测。** 用虚拟机，或一台空闲的测试机。[VM] 项全部在虚拟机里做，每组开始前打一个快照，坏了就回滚。
2. 真机项用一台空闲的 Mac / PC。先做完整备份：Mac 用 Time Machine，Windows 建还原点并备份用户目录。用 Tono **测试账号**登录，不用个人账号。
3. 手边留一台**能上网的第二台设备**（手机热点也行），本机断网时还能看这份文档。远程控制（SSH、Tailscale、远程桌面）可能被测试本身切断，真机项要有人坐在机器前面。
4. 记一份基线，测完逐项对比：

   macOS：
   ```sh
   networksetup -listallnetworkservices
   networksetup -getdnsservers "Wi-Fi"        # 对每个在用的服务
   scutil --dns | head -40
   sudo pfctl -s info | head -3                # Status: Enabled/Disabled
   sudo pfctl -a tono.killswitch -sr           # 未连接时应为空
   ls -l /etc/resolver 2>/dev/null
   netstat -rn | grep -E '160\.79\.104|2607:6bc0'
   ls -l /Library/PrivilegedHelperTools/ | grep -i tono
   ```
   Windows（管理员 PowerShell）：
   ```powershell
   Get-NetAdapter | Select-Object Name, InterfaceIndex, Status
   Get-DnsClientServerAddress | Select-Object InterfaceIndex, AddressFamily, ServerAddresses
   Get-DnsClientNrptRule
   netsh wfp show filters file="$env:TEMP\wfp-base.xml"; (Select-String "$env:TEMP\wfp-base.xml" -Pattern '>Tono ').Count
   netsh advfirewall firewall show rule name="Tono selective anthropic v4"
   Get-FileHash -Algorithm SHA256 'C:\Program Files\Tono\sing-box.exe'
   ```
5. Windows 动 `Program Files\Tono` 里的文件（F2）之前，先把整个目录、App 数据目录下的 `sing-box-core.json`（没有就记「无」）复制到别处；虚拟机直接用快照。

## 1. 断网了怎么恢复

按顺序试，前一步好了就停。命令都出自仓库文档或安装器。

### macOS

1. App 里点「断开」。处于「保护离线」时点「恢复网络」。
2. 终端：`sudo /Library/PrivilegedHelperTools/tono-core-helper --emergency-disarm`。放行 PF，尽量恢复 DNS（DNS 恢复失败也放行 PF），并删除 AI 窄层。核心卡死杀不掉时也照样放行（#763）。
3. 还不行：`sudo /Library/PrivilegedHelperTools/tono-core-helper --emergency-reset`（放行后移除 helper）。
4. helper 起不来，或在安全模式 / 恢复系统里：
   ```sh
   sudo pfctl -a tono.killswitch -F all
   sudo pfctl -d
   ```
   若 `/etc/pf.conf` 里还有 `# BEGIN TONO KILL SWITCH` 段，删掉 BEGIN 到 END（含两行标记），再 `sudo pfctl -f /etc/pf.conf` 和 `sudo pfctl -d`。DNS 仍是 `127.0.0.1` 时，对每个在用的服务执行 `sudo networksetup -setdnsservers "Wi-Fi" Empty`。
5. 做过 G2 的：先 `sudo chflags noschg /etc/resolver/*`，再做第 2 步，否则 AI 窄层文件删不掉。
6. 删掉 `/Applications/Tono.app` 后 helper 约 10 秒内放行 PF。DNS 没恢复、旧核心没停掉、或 AI 窄层没删干净时，helper 会**故意留着**并每 10 秒重试（#1222 #1268 #1302），这是设计如此。要立即删掉 helper，用第 3 步。
7. 只是 Claude / ChatGPT 打不开、其他网站正常：这是 AI 窄层（`/etc/resolver/<后缀>` 指向 `192.0.2.1`，外加 `160.79.104.0/23`、`2607:6bc0::/48` 黑洞路由），不影响普通上网。第 1 步的「恢复网络」或第 2 步会删掉它。

### Windows

1. App 里点「断开」。「保护离线」时点「恢复网络」。
2. 开始菜单 **「Tono — 恢复网络 (Restore Network)」**，右键「以管理员身份运行」（执行 `tono-service.exe --emergency-disarm`）。服务还握着 owner lock 时会拒绝，先退出 Tono 再运行。
3. 还不行：管理员命令行 `sc stop TonoService`，停完再运行一次第 2 步。
4. 再运行一次安装程序或卸载程序。卸载程序证明不了拦截已解除就不删文件。
5. **不要先重启。** 安装器原文：阻断过滤器会活过重启。先做第 2–4 步。
6. 干净的标准：`netsh wfp show filters` 里没有 `Tono ` 开头的过滤器；DNS 与基线一致；`Get-DnsClientNrptRule` 里没有指向 `192.0.2.1` 或 `198.18.0.2` 的规则；`Tono selective anthropic v4/v6` 防火墙规则只在 AI 窄层生效时存在。

## 2. 判定规则（决策 031）

**Tono 不能把用户断网。** 非严格模式下任何失败：普通网络回来，AI 仍被拦（AI 窄层）。只有严格模式才全阻断。两个平台的生产版都**没有用户可开的严格开关**，本轮不测严格模式。

每个失败路径项都看这三件事，缺一条就判失败：

1. **普通网络回来了**：`curl -m 10 -sI https://www.baidu.com` 成功；DNS 回到基线；macOS `sudo pfctl -a tono.killswitch -sr` 为空，Windows 没有 `Tono ` 过滤器。不能停在「已保护」或 Blocked 却没网。
2. **AI 窄层在**：`curl -m 10 -sI https://claude.ai` 失败。macOS：`/etc/resolver/claude.ai` 内容为 `nameserver 192.0.2.1`，`netstat -rn | grep 160.79.104` 有黑洞路由，`curl -m 10 -sI --resolve claude.ai:443:160.79.104.1 https://claude.ai` 失败。Windows：`Get-DnsClientNrptRule` 有 `claude.ai` → `192.0.2.1`，有 `Tono selective anthropic v4/v6` 防火墙规则。
3. **用户点「恢复网络」或「断开」后窄层被删掉**（设计如此）。

说明：

- AI 窄层是尽力而为，挡不住 DoH、已缓存地址、Cloudflare 上的 ChatGPT 真实 IP。只看上面三点。
- 2026-10-01 清单里「macOS App 侧选择性 AI 钩子没注册」的已知缺口**已不成立**：App 侧自动放行都走 `releaseAfterFailure`（保留 AI 层）。macOS 上「普通网络回来、claude.ai 能直连」一律判失败。
- 用户主动退出 / 断开会把 AI 窄层一起删掉（[MAC-QUIT-AI-HOLD](../findings.d/MAC-QUIT-AI-HOLD.md)，待老板决定），不判失败。
- Windows 默认内核是 sing-box。下文没写内核的 Windows 项都在默认 sing-box 下做，「杀核心」杀的是 `sing-box.exe`。

## 3. 构建

- **Windows**：`gh workflow run windows-candidate.yml --ref <main SHA>`（不签名、不发 release、不碰更新通道）。#1215 已由 #1235 修复，能否出包以实际 run 为准。产物 `tono-windows-0.0.74-candidate-<sha>` 里有 NSIS `*-setup.exe` 和 `candidate-manifest.json`；传到测试机后用 `Get-FileHash -Algorithm SHA256` 对 manifest。SmartScreen 拦时点「更多信息 → 仍要运行」，不要关 SmartScreen。
- **macOS**：CI 的 `Tono-macOS-beta.zip` 未签名，helper 不认，不能测网络。用签名候选（`macos-release.yml` 的 `candidate_only`，要老板批准），或在有 Developer ID 证书的 Mac 上跑 `tooling/scripts/build-macos-local-verify.sh`（**不加** `--install`）。
- **原生（应用内）更新**（E1、E2）要配对的签名候选和测试更新源。上面的包都测不了，没有就整组记「未测」。

## 4. 测试项

### A. 安装 / 升级 / 卸载

| ID | 类 | 平台 | 步骤 | 期望结果 | 覆盖 PR |
|---|---|---|---|---|---|
| A1 | 真机 | Win | 全新安装候选包。核对 `sing-box.exe` 摘要等于 `sing-box-sha256.txt`。执行 `icacls "C:\Program Files\Tono"` 和 `(Get-Acl "C:\Program Files\Tono").Owner`。连接、断开、切换节点、开微信直连。连着时再运行一次安装包；断开后再运行一次（修复安装）。 | 服务自动运行，不静默弹界面。摘要是 alpha.9。属主和写权限只有 SYSTEM / Administrators / TrustedInstaller；否则连接会被拒（401/503），记录下来，网络不能断。连接各步都成功。连着时安装包提示「仍在连接中」且不改动；断开后修复成功或返回「需要重启」。 | [#776](https://github.com/raydocs/tono/pull/776) [#1159](https://github.com/raydocs/tono/pull/1159) [#352](https://github.com/raydocs/tono/pull/352) |
| A2 | 真机 | Win | 先装当前客户发布版（不带 `sing-box.exe`），再用候选包覆盖升级，断开和已连接各一次。另做一次：升级时用记事本占住 `Program Files\Tono` 里的一个文件制造回滚，再重试。 | 两种状态都升级成功（已连接时按提示先断开）。升级后 `sing-box.exe` 在、摘要对，DNS 与基线一致，能连接。回滚时新引入的 `sing-box.exe` 被删掉，其余文件恢复原样；重试成功。 | [#801](https://github.com/raydocs/tono/pull/801) [#1159](https://github.com/raydocs/tono/pull/1159) |
| A3 | 真机 | Win | 连着时从「设置 → 应用」卸载 Tono。 | 卸载程序先跑 emergency-disarm。之后没有 `Tono ` 过滤器，NRPT 和防火墙里没有 Tono 规则，DNS 与基线一致，服务和 `sing-box.exe` 都被删除。证明不了已解除时拒绝删文件并提示用「恢复网络」。 | [#1004](https://github.com/raydocs/tono/pull/1004) [#1022](https://github.com/raydocs/tono/pull/1022) [#1159](https://github.com/raydocs/tono/pull/1159) |
| A4 | 真机 | mac | 先装当前客户发布版并连上。在发布版上用 C1 的方法（杀核心）触发一次自动放行，看 `/etc/resolver/claude.ai` 有没有出现（没有就把本项后半记「未测」）。退出后换成候选打开。helper 升级的管理员提示先点「取消」，再重试并「允许」。然后连接，再点「恢复网络」。 | 取消后网络能用，`pfctl -a tono.killswitch -sr` 为空，不会等 45 秒才报错。允许后 helper 升级成功。旧版留下的 AI 文件不会让每次连接都卡在「保护离线」；连接正常，「恢复网络」后 `/etc/resolver` 里没有 AI 后缀文件。 | [#794](https://github.com/raydocs/tono/pull/794) [#759](https://github.com/raydocs/tono/pull/759) [#840](https://github.com/raydocs/tono/pull/840) [#1237](https://github.com/raydocs/tono/pull/1237) |
| A5 | VM | mac | 在 A4 的 helper 升级窗口里同时点「修复 helper」。另做一次：复制一份 `Tono.app`，用 `mkfifo` 把内嵌 helper 或 Core 换成命名管道再触发升级。再做一次：把 App 运行目录里的 `config.json` 换成 `mkfifo` 管道后点连接。最后执行一次 `--emergency-disarm`。 | 重叠操作后 helper 仍在，PF 不会停在有规则没守护。FIFO 包被拒绝并报错，界面不挂起。FIFO 配置让连接很快失败，helper 仍有响应，网络不被永久阻断。`--emergency-disarm` 恢复 DNS 和 PF。 | [#1130](https://github.com/raydocs/tono/pull/1130) [#1166](https://github.com/raydocs/tono/pull/1166) [#763](https://github.com/raydocs/tono/pull/763) |

macOS 卸载见 G1。

### B. 连接 / 断开 / 切换

| ID | 类 | 平台 | 步骤 | 期望结果 | 覆盖 PR |
|---|---|---|---|---|---|
| B1 | VM | mac | 记基线。登录，连一个 VLESS 节点，一看到「已连接」就打开新网站（量首字节），再开国内站和 claude.ai。依次断开、再连、退出 Tono。 | 首连能用，claude.ai 走出口。首字节不被延迟探测拖慢，延迟数字约 1.5 秒后才出现。断开和退出后 DNS 与基线一致，PF 为空，`/etc/resolver` 没有 AI 后缀文件，`dig claude.ai` 返回真实地址（不是 `198.18.x`）。 | [#741](https://github.com/raydocs/tono/pull/741) [#744](https://github.com/raydocs/tono/pull/744) [#1031](https://github.com/raydocs/tono/pull/1031) [#1126](https://github.com/raydocs/tono/pull/1126) |
| B2 | VM | Win | 记基线，不写 `sing-box-core.json`，**冷启动后第一次**连接。看 `Get-CimInstance Win32_Process -Filter "Name='sing-box.exe'"` 和有没有 `tono-core.exe`；量首字节和延迟数字出现时间。断开，再连，托盘「退出」。另做一次：点「退出」后选「留下」，再在后台改目录。 | 跑的是 `sing-box.exe`（参数含 `run -c`），没有 `tono-core.exe`。首连到「已连接」，日志里没有 `TONO_TUN_ROUTE_UNAVAILABLE`，不会约 2 秒被杀重试。延迟数字约 1.5 秒后出现。退出几秒内结束，DNS 回基线，没有 `Tono ` 过滤器。选「留下」后目录改动在正常同步周期内生效。 | [#1140](https://github.com/raydocs/tono/pull/1140) [#1196](https://github.com/raydocs/tono/pull/1196) [#1243](https://github.com/raydocs/tono/pull/1243) [#1122](https://github.com/raydocs/tono/pull/1122) [#741](https://github.com/raydocs/tono/pull/741) [#784](https://github.com/raydocs/tono/pull/784) [#1038](https://github.com/raydocs/tono/pull/1038) |
| B3 | VM | Win | 连着时热切换 VLESS → HY2 → VLESS。开很多标签页，热切换后立刻「断开」。再做一次：用路由器封掉出口 A 的数据面，健康检查开始失败时立刻热切到 B。 | 延迟和出口 IP 属于新节点。HY2 上普通 UDP（视频通话）能用，VLESS 上照旧拒绝。立刻断开几秒内完成。B 不被 A 的健康失败误释放，连接保持在 B。 | [#945](https://github.com/raydocs/tono/pull/945) [#787](https://github.com/raydocs/tono/pull/787) [#783](https://github.com/raydocs/tono/pull/783) [#1133](https://github.com/raydocs/tono/pull/1133) [#1150](https://github.com/raydocs/tono/pull/1150) |
| B4 | VM | 双平台 | 开住宅路由，选 HY2 出口。浏览器（QUIC 开着）打开 Claude、ChatGPT、Gemini、国内网站。开着微信直连再开一次 claude.ai。`curl -s https://dashscope.aliyuncs.com` 和一个普通 `aliyuncs.com` 站点。Windows 另连一次和住宅 VLESS 同 IP:443 的 HY2 出口。 | 助手看到的出口 IP 是住宅 IP；没有 QUIC 走云 HY2 出口（被拒后浏览器回落 TCP 走住宅）。国内站直连；微信直连开着时 claude.ai 仍走出口。DashScope 走出口，普通 `aliyuncs.com` 直连。同 IP:443 能连上。 | [#783](https://github.com/raydocs/tono/pull/783) [#797](https://github.com/raydocs/tono/pull/797) [#871](https://github.com/raydocs/tono/pull/871) [#867](https://github.com/raydocs/tono/pull/867) [#1084](https://github.com/raydocs/tono/pull/1084) [#1272](https://github.com/raydocs/tono/pull/1272) |
| B5 | VM（要后台配合） | mac | 连着住宅会话、国内站走 DIRECT 时，后台依次：(a) 住宅节点同名换 UUID，并在切换 A→B 过程中轮换 B 的凭据；(b) 改托管直连域名，触发策略和 pins 刷新；把运行配置目录设成不可写后再刷新一次；(c) 发布撤销某 DIRECT 授权的策略，节点切换中再发一次；(d) 目录里同时删掉 A 和正在切换的 B，保留 C；(e) 一次不涉及当前节点的目录更新。 | (a) 核心各重载一次，助手走新凭据的住宅出口。(b) 可写时照常应用不掉线；不可写时隧道不断，界面报错。(c) 不重连，该域名随即不再走物理网卡，切换后撤销仍生效。(d) 最终稳定在 C。(e) 不重载、不断线。 | [#781](https://github.com/raydocs/tono/pull/781) [#802](https://github.com/raydocs/tono/pull/802) [#778](https://github.com/raydocs/tono/pull/778) [#782](https://github.com/raydocs/tono/pull/782) [#950](https://github.com/raydocs/tono/pull/950) [#1039](https://github.com/raydocs/tono/pull/1039) [#1115](https://github.com/raydocs/tono/pull/1115) [#1149](https://github.com/raydocs/tono/pull/1149) [#1153](https://github.com/raydocs/tono/pull/1153) [#1158](https://github.com/raydocs/tono/pull/1158) |
| B6 | VM（要后台配合） | Win | 连着时后台：(a) 改 `homeProxy` 或换住宅 UUID，并有一次发生在「连接中」；(b) 内容不变，只把策略 revision +1 重发，等 2 分钟；(c) 目录只加城市；(d) HY2 → VLESS 冷切换并等 60 秒。 | (a) 冷重建一次，WFP 保持武装，连上后用新住宅。(b) 一直 Connected，服务日志没有 Blocked。(c) 不重连。(d) 一次连上，不停在断开等人点。 | [#787](https://github.com/raydocs/tono/pull/787) [#786](https://github.com/raydocs/tono/pull/786) [#1066](https://github.com/raydocs/tono/pull/1066) [#1070](https://github.com/raydocs/tono/pull/1070) |
| B7 | VM（要后台配合） | Win | 预发目录放三个测试出口：(a) VLESS 省略 `client-fingerprint`；(b) 名字带方括号，如 `Tokyo [primary]`；(c) `· hy2` 出口，带和不带 SPKI 各一个。先选一个正常节点连接，再依次选这些。sing-box 和显式 mihomo（F1 的做法）各一遍。 | 没被选中的节点不让整个目录编译失败，正常节点一定能连。(a)(b) 能连。带 SPKI 的 HY2 能连；没有 SPKI 的 HY2 在 sing-box 下标为不可用，不让整个连接失败。 | [#1157](https://github.com/raydocs/tono/pull/1157) [#1148](https://github.com/raydocs/tono/pull/1148) |
| B8 | VM | Win | 账号 A 连接后登出，换账号 B 登录并连接。 | 用的是 B 选中的节点，不拨 A 的故障转移节点。 | [#874](https://github.com/raydocs/tono/pull/874) [#1047](https://github.com/raydocs/tono/pull/1047) |
| B9 | VM | mac | 给在用的网络服务手工设 10 个以上 DNS（含一个 IPv6）。连接，断开；再连接，然后 `sudo pkill -9 -f sing-box`。 | 每次 DNS 都完全恢复成手设列表，顺序不变，不留 `127.0.0.1`。 | [#765](https://github.com/raydocs/tono/pull/765) [#1033](https://github.com/raydocs/tono/pull/1033) [#744](https://github.com/raydocs/tono/pull/744) |
| B10 | VM | Win | 网卡手工设 IPv4 / IPv6 DNS（空格分隔列表），开 Windows DoH 和浏览器安全 DNS。连接后中途加一块新网卡，断开。再连，用 C9 的方式杀 App。最后：用 PowerShell 占住 `protected-dns.json`（`$f=[IO.File]::Open($path,'Open','Read','None')`，路径看服务日志）后断开，期间手工把 DNS 改成新值，解除占用，再连再断。 | 前两次服务器列表、DoH 标志、浏览器安全 DNS 和新网卡原设置都完全恢复。最后一次断开成功，最终 DNS 是刚改的新值，不被旧会话覆盖。 | [#985](https://github.com/raydocs/tono/pull/985) [#987](https://github.com/raydocs/tono/pull/987) [#989](https://github.com/raydocs/tono/pull/989) [#868](https://github.com/raydocs/tono/pull/868) [#754](https://github.com/raydocs/tono/pull/754) [#1076](https://github.com/raydocs/tono/pull/1076) |

### C. 失败回退与 AI 拦截

本组每一项都按第 2 节三点判。

| ID | 类 | 平台 | 步骤 | 期望结果 | 覆盖 PR |
|---|---|---|---|---|---|
| C1 | VM | mac | (a) 连上后 `sudo pkill -9 -f sing-box`（先 `pgrep -fl sing-box` 确认），等 1 分钟。(b) 点「连接」，「连接中」时 `pkill -9 -x Tono`，不重开，等 1 分钟。之后各点「恢复网络」或重连。 | 约 30 秒内普通网络回来，AI 窄层在。点恢复后窄层消失；重开 App 能正常连接。 | [#738](https://github.com/raydocs/tono/pull/738) [#773](https://github.com/raydocs/tono/pull/773) [#1028](https://github.com/raydocs/tono/pull/1028) |
| C2 | VM | mac | (a) 在路由器屏蔽出口 IP 后点「连接」。(b) 连上后屏蔽出口，等自愈次数用完，解除屏蔽。(c) 再屏蔽一次，后台探测期间点「恢复网络」。(d) A 被屏蔽、B 健康时让它走后台恢复。 | (a) 很快失败，不装隧道，普通网络一直能用。(b) 用完次数后普通网络回来、AI 窄层在，只在后台探测；解除后 TCP 证明通过才自动重连。(c) 点了恢复后不再自动重连。(d) 连上 B，不反复重连 A，间隔逐步变长。 | [#718](https://github.com/raydocs/tono/pull/718) [#720](https://github.com/raydocs/tono/pull/720) [#714](https://github.com/raydocs/tono/pull/714) [#1048](https://github.com/raydocs/tono/pull/1048) [#1043](https://github.com/raydocs/tono/pull/1043) [#1086](https://github.com/raydocs/tono/pull/1086) |
| C3 | VM | mac | (a) 连上后在 Chrome 打开「安全 DNS」。(b) 连着时 `sudo pfctl -d`。 | (a) 约 1 分钟内断开并提示安全 DNS，网络立刻能用，AI 窄层在。(b) 下一次检查时重新武装，不会在 PF 关着时显示「已保护」，不永久断网。 | [#760](https://github.com/raydocs/tono/pull/760) [#761](https://github.com/raydocs/tono/pull/761) [#1061](https://github.com/raydocs/tono/pull/1061) |
| C4 | VM（要后台配合） | mac | 连着住宅会话时分别触发：(a) 后台把当前出口从目录删掉；(b) 后台轮换住宅凭据，重载进行中 `sudo pkill -9 -f sing-box`；(c) 发布一个应用失败的策略。每次放行后看第 2 节第 2 点（含 `--resolve` 直连 IP）。 | 三种都：普通网络回来、PF 为空、AI 窄层在（黑洞路由带网关，直连 IP 失败）。只开普通网络、把 AI 一并放掉的判失败。 | [#963](https://github.com/raydocs/tono/pull/963) [#966](https://github.com/raydocs/tono/pull/966) [#1103](https://github.com/raydocs/tono/pull/1103) [#1146](https://github.com/raydocs/tono/pull/1146) [#1110](https://github.com/raydocs/tono/pull/1110) |
| C5 | VM | mac | 连着时制造 split-DNS 冲突：`echo 'nameserver 10.0.0.53' \| sudo tee /etc/resolver/corp.example`（或连一个推 split-DNS 的公司 VPN），然后关开网卡触发网络变化。另做一次：让受保护 DNS 连续审计失败（例如把上游 DHCP DNS 指向不响应的地址）。测完删掉 `corp.example`。 | 网络**立刻**回来（不等约 30 秒的看门狗），claude.ai 和 chatgpt.com 仍被拦。界面说已回到普通网络、AI 仍拦，不显示「Kill Switch 正在阻断，重试已暂停」。不自动重连。 | [#1285](https://github.com/raydocs/tono/pull/1285) |
| C6 | VM | mac | (a) 选 `· hy2` 节点，在路由器封 UDP，让连接连续失败三次。(b) 连着时 `pkill -9 -x Tono`，约 10 秒内重开（helper 看门狗 30 秒之前）。(c) 连着时直接重启虚拟机。 | (a) 三次后普通网络回来、AI 窄层在，提示「改选 Reality」，不再循环重试。(b)(c) 开机 / 重开就有网，不从 `pf.conf` 装入阻断；出现重启保持时立即放行并保留 AI 窄层，不自动重连；界面先显示「正在恢复普通网络」再显示「已回到普通网络、AI 仍拦」。 | [#1306](https://github.com/raydocs/tono/pull/1306) [发布就绪](../RELEASE_READINESS.md)「崩溃、重启」 |
| C7 | VM（先快照） | mac | 连上后把 `/Library/Application Support/Tono` 设成只读（或填满磁盘），然后断开。恢复后再连，用 `--emergency-disarm` 收尾。 | 两种方式网络都回来，PF 为空。 | [#761](https://github.com/raydocs/tono/pull/761) [#889](https://github.com/raydocs/tono/pull/889) |
| C8 | VM（要后台配合） | mac | 先用 C1(a) 让 AI 窄层在。后台撤销这台设备的会话，等 App 自动登出。`pkill -9 -x Tono` 后重开（保持未登录）。最后再主动登录一次并点「退出登录」。 | 重开后普通网络能用，`/etc/resolver/claude.ai` 和黑洞路由**仍在**，登录不受影响。主动退出登录才删掉 AI 窄层。 | [#1226](https://github.com/raydocs/tono/pull/1226) |
| C9 | VM | Win | 开着微信直连连上，在任务管理器结束 `Tono.exe`，等 70 秒，看进程、网卡、DNS。然后重开 App，在显示 Connected 之前点「退出」。另做一次：直连发现后 20 秒内断开并立刻重连。 | 60–70 秒内普通网络回来，`sing-box.exe` 和 TUN 网卡都没了，DNS 正常，没有 `Tono ` 过滤器，AI 窄层在。马上退出后网络正常。快速断开重连时，旧会话的迟到失败不清掉新会话的 DIRECT。 | [#777](https://github.com/raydocs/tono/pull/777) [#784](https://github.com/raydocs/tono/pull/784) [#1044](https://github.com/raydocs/tono/pull/1044) [#1074](https://github.com/raydocs/tono/pull/1074) [#1116](https://github.com/raydocs/tono/pull/1116) [#926](https://github.com/raydocs/tono/pull/926) |
| C10 | VM | Win | 另开窗口持续 `while(1){curl.exe -m 3 -sI https://claude.ai; sleep 1}`。连上后反复 `taskkill /F /IM sing-box.exe`，直到服务不再拉起核心。放行后再杀一次核心或重启服务，再触发一次放行。 | 恢复次数用完后放行：普通网络回来，AI 窄层在，不会一直 Blocked。**循环里 claude.ai 一次都不能成功**（WFP 拆除前 AI 窄层已装好，刷新时没有先删后加的空窗）。不会改去启动 `tono-core.exe`（mihomo）。 | [#738](https://github.com/raydocs/tono/pull/738) [#1032](https://github.com/raydocs/tono/pull/1032) [#1021](https://github.com/raydocs/tono/pull/1021) [#1012](https://github.com/raydocs/tono/pull/1012) [#1278](https://github.com/raydocs/tono/pull/1278) [#1087](https://github.com/raydocs/tono/pull/1087) [#1140](https://github.com/raydocs/tono/pull/1140) |
| C11 | VM | Win | (a) 连上后在路由器屏蔽出口 IP，等健康监视器放弃，然后解除。(b) 出口 TCP 能连但握手失败（出口上停 Xray，`socat` 空监听 443），观察 5 分钟以上，期间改选一个健康节点，然后恢复出口。 | (a) 放弃时只放行一次，普通网络回来、AI 窄层在；之后 TCP 证明通过才重连。(b) 重连间隔逐步变长，不会每 2 秒武装又释放；期间普通网络在、AI 仍拦；改选的节点不被旧节点的证明盖掉；出口恢复后自动重连。 | [#714](https://github.com/raydocs/tono/pull/714) [#715](https://github.com/raydocs/tono/pull/715) [#1003](https://github.com/raydocs/tono/pull/1003) [#1010](https://github.com/raydocs/tono/pull/1010) [#1106](https://github.com/raydocs/tono/pull/1106) [#1138](https://github.com/raydocs/tono/pull/1138) [#1098](https://github.com/raydocs/tono/pull/1098) |
| C12 | VM | Win | 全新登录后第一次点「连接」，「连接中」时禁用虚拟网卡 10 秒再启用；另一次改为结束 `Tono.exe`。 | 不卡在 Blocked。普通网络回来，AI 窄层在。重开或重试能连上。 | [#1005](https://github.com/raydocs/tono/pull/1005) [#718](https://github.com/raydocs/tono/pull/718) |
| C13 | VM（要后台配合） | Win | 连着时后台把当前出口从目录删掉；删完另选一个节点。 | 一个同步周期内普通网络回来，DNS 恢复，没有 `Tono ` 过滤器，AI 窄层在。界面请用户选节点，不自己重连；选别的节点能连上。 | [#791](https://github.com/raydocs/tono/pull/791) [#1036](https://github.com/raydocs/tono/pull/1036) |
| C14 | VM | Win | (a) 连上后 `sc stop TonoService`。(b) 先让自动放行发生（C10），然后 `sc stop TonoService`，再在任务管理器强杀服务进程，再 `sc start TonoService`。(c) 连上后直接关机再开机。(d) 连上后重启虚拟机。 | (a) `sc stop` 不超时，网络正常，DNS 恢复，没有 `Tono ` 过滤器，AI 窄层在。(b) 服务重启后 AI 窄层仍在。(c)(d) 开机就有网，不阻断；App 在后台重连。任何时候都不会开机后一直 Blocked。 | [#792](https://github.com/raydocs/tono/pull/792) [#902](https://github.com/raydocs/tono/pull/902) [#1014](https://github.com/raydocs/tono/pull/1014) [#740](https://github.com/raydocs/tono/pull/740) [#753](https://github.com/raydocs/tono/pull/753) [#986](https://github.com/raydocs/tono/pull/986) [#1029](https://github.com/raydocs/tono/pull/1029) [#974](https://github.com/raydocs/tono/pull/974) [#1147](https://github.com/raydocs/tono/pull/1147) [#1244](https://github.com/raydocs/tono/pull/1244) [#1266](https://github.com/raydocs/tono/pull/1266) |
| C15 | VM | Win | (a) 连着时以管理员运行「Tono — 恢复网络」，App 开着一次、退出 App 后一次。(b) 自动放行后（AI 窄层在）重开 App，断开账号网络几秒让账号读取超过 8 秒，在登录前的界面点「恢复网络」。(c) 自动放行进行到一半时立刻点「断开」，等 1 分钟。 | (a) 记下 App 开着时是否被拒（已知会拒）；退出后一定放行，AI 窄层也被删掉。(b)(c) AI 防火墙和 NRPT 规则最终都被删掉（用户明确恢复优先）。 | [#1112](https://github.com/raydocs/tono/pull/1112) [#1142](https://github.com/raydocs/tono/pull/1142) [#1295](https://github.com/raydocs/tono/pull/1295) [发布就绪](../RELEASE_READINESS.md)「进程外恢复」 |

### D. 睡眠唤醒 / 网络切换

| ID | 类 | 平台 | 步骤 | 期望结果 | 覆盖 PR |
|---|---|---|---|---|---|
| D1 | 真机 | mac | 连着时合盖睡眠 5 分钟；再睡一晚。另做一次：先用 C6(a) 让它停在 HY2 暂停，再合盖、开盖。 | 唤醒后要么自动恢复连接，要么普通网络能用（AI 窄层在）。不会卡在「已保护」却没网。处于暂停时唤醒立即放行并保留 AI 窄层，不自动重连。 | [#889](https://github.com/raydocs/tono/pull/889) [#1028](https://github.com/raydocs/tono/pull/1028) [#1306](https://github.com/raydocs/tono/pull/1306) |
| D2 | 真机 | mac | 连着时：换一个 Wi-Fi；关 Wi-Fi 10 秒再开；插拔网线或扩展坞；在 DHCP 慢的网络重连 Wi-Fi（会短暂拿到 169.254 网关）。最后插第二块 USB 以太网卡（`en0` 仍是默认），看 `sudo pfctl -a tono.killswitch -sr`，并从新网卡局域网解析一个域名。 | 只有默认上行真的变了才重建隧道，169.254 空档不算漫游，始终不永久断网。新网卡的局域网 DNS / DoT 也在 PF 作用域内，不绕过；已有会话许可不被撤销。 | [#835](https://github.com/raydocs/tono/pull/835) [#1135](https://github.com/raydocs/tono/pull/1135) |
| D3 | 真机 | Win | 连着时睡眠 5 分钟；再睡一晚。另做一次：在 C11(b) 的握手失败重连期间睡眠 5 分钟后唤醒。 | 唤醒后自动恢复连接，或者普通网络能用；不一直 Blocked。握手失败那次唤醒后后台恢复仍在跑，出口恢复后自动重连。 | [#740](https://github.com/raydocs/tono/pull/740) [#986](https://github.com/raydocs/tono/pull/986) [#1138](https://github.com/raydocs/tono/pull/1138) |
| D4 | 真机（有线 + Wi-Fi 的笔记本） | Win | 开着微信直连连上，拔网线；换 Wi-Fi；在设置里禁用 Wi-Fi 网卡；1 秒内快速切换两次网络。 | 只重连一次（防抖窗口内的变化顺延，不丢）。DIRECT 不绑到已断开的网卡；所有硬件网卡都断开时退回全隧道。始终不永久断网。 | [#878](https://github.com/raydocs/tono/pull/878) [#879](https://github.com/raydocs/tono/pull/879) |
| D5 | 真机（家用宽带，不经虚拟机 NAT） | 双平台 | 连 `· hy2` 节点，空闲 2 分钟、5 分钟各一次，再打开 claude.ai。之后正常使用 4 小时以上（可与 D1–D4 同时挂着）。 | 不重连就能用。失败时日志有 `TONO_CONNECT_HY2_IDLE`，在同一线路重试，不要求换节点。4 小时内没有重连循环，日志流不因安静而反复重连。 | [#749](https://github.com/raydocs/tono/pull/749) [#730](https://github.com/raydocs/tono/pull/730) [#1027](https://github.com/raydocs/tono/pull/1027) |

### E. 更新回滚 / 恢复

E1、E2 要配对的签名候选和测试更新源（第 3 节），没有就记「未测」。

| ID | 类 | 平台 | 步骤 | 期望结果 | 覆盖 PR |
|---|---|---|---|---|---|
| E1 | 真机 | mac | (a) 已连接时做一次应用内更新。(b) 处于「保护离线」时做一次。(c) 更新挂起时点「恢复网络」。(d) 连着时让更新准备失败（拒绝写更新暂存目录）。(e) 连续更新两次。 | (a) 更新后需要已验证的连接才提交，连接正常。(b) 重开后更新提交，「连接」可用，PF 未武装。(c) 恢复生效，更新状态不卡住，之后能连接。(d) 报错，从「保护离线」变成「未连接」，普通网络能用，DNS 恢复，AI 窄层在。(e) 第二次前清掉上一次的备份。 | [#795](https://github.com/raydocs/tono/pull/795) [#1220](https://github.com/raydocs/tono/pull/1220) [#971](https://github.com/raydocs/tono/pull/971) [#1099](https://github.com/raydocs/tono/pull/1099) [#891](https://github.com/raydocs/tono/pull/891) [#991](https://github.com/raydocs/tono/pull/991) [#993](https://github.com/raydocs/tono/pull/993) [#785](https://github.com/raydocs/tono/pull/785) [#1001](https://github.com/raydocs/tono/pull/1001) [#1064](https://github.com/raydocs/tono/pull/1064) |
| E2 | 真机 | Win | (a) 从发布版应用内更新到候选（含 `sing-box.exe` 成员）。(b) 连着时让更新 Prepare 失败（拒绝写暂存目录）。(c) 更新执行中占住一个安装文件，造成回滚。(d) 连续更新两次。 | (a) `sing-box.exe` 随更新装好，摘要对；pin 缺失或不符的包被拒。(b) 报错，网络能用，没有 `Tono ` 过滤器，AI 窄层在，App 不被关掉。(c) 回滚后放行：普通网络回来、AI 窄层在、服务能起来。(d) 第二次前清掉上一次的备份。 | [#779](https://github.com/raydocs/tono/pull/779) [#793](https://github.com/raydocs/tono/pull/793) [#1007](https://github.com/raydocs/tono/pull/1007) [#1040](https://github.com/raydocs/tono/pull/1040) [#858](https://github.com/raydocs/tono/pull/858) [#961](https://github.com/raydocs/tono/pull/961) [#1042](https://github.com/raydocs/tono/pull/1042) [#978](https://github.com/raydocs/tono/pull/978) [#1017](https://github.com/raydocs/tono/pull/1017) [#1025](https://github.com/raydocs/tono/pull/1025) [#1159](https://github.com/raydocs/tono/pull/1159) |
| E3 | VM（开发在场，先快照） | Win | 候选已含 [#1297](https://github.com/raydocs/tono/pull/1297)。开发按 #1297 的方法让更新回滚**连续失败**。观察服务启动 / 恢复执行器的循环次数，再重启一次虚拟机。 | 恢复执行器最多跑 3 次后不再被拉起；服务正常启动，更新状态带 `needs_attention`（日志有警告）。每次都是普通网络回来、AI 窄层在，不会停在启动屏障里。重启后循环不再开始。之后安装 / 更新 / 卸载被拒是已知问题 #1307，不判本项失败。 | [#1297](https://github.com/raydocs/tono/pull/1297) |

### F. Windows sing-box 默认内核

| ID | 类 | 平台 | 步骤 | 期望结果 | 覆盖 PR |
|---|---|---|---|---|---|
| F1 | VM | Win | 写 `{"schema":2,"device_id":"<installation_id>","core":"mihomo"}` 到 `sing-box-core.json` 再连接；断开，换 schema 1 的 `{"sing_box_core":false,...}` 再连；断开，把 `device_id` 改成别的值再连；最后删掉文件再连。mihomo 下做一次 B2 的冷首连。 | 前两次跑 `tono-core.exe`（mihomo），冷首连日志没有 `TONO_TUN_ROUTE_UNAVAILABLE`。`device_id` 不对和删文件后都回到 sing-box。 | [#1140](https://github.com/raydocs/tono/pull/1140) [#1243](https://github.com/raydocs/tono/pull/1243) |
| F2 | VM | Win | 断开状态下：(a) 把 `sing-box.exe` 改名挪走；(b) 恢复后改 `sing-box-sha256.txt` 的一个字符。每次都点连接，测完恢复原件。 | 两次都在武装前自动改跑 mihomo，能连上，普通网络在，AI 仍拦。日志有回退原因（缺失 / 摘要不符）。**只有这一步会自动回退。** | [#1140](https://github.com/raydocs/tono/pull/1140) |
| F3 | VM | Win | 默认 sing-box 连着时：(a) 把 `sing-box-core.json` 写成 mihomo，不断开，等 2 分钟；(b) 屏蔽出口到「保护离线」，再解除让它自动重连。 | 武装期间不换核：(a) 仍是 `sing-box.exe`，断开重连后才换；(b) 重连后仍是 sing-box。 | [#1140](https://github.com/raydocs/tono/pull/1140) [#1196](https://github.com/raydocs/tono/pull/1196) |
| F4 | VM | Win | 默认 sing-box，开着微信（或别的已审应用）直连连上。用 `Get-NetTCPConnection -OwningProcess (Get-Process <应用>).Id` 看它的连接；同时对 claude.ai `curl`；另开窗口持续 `ping -t` 国内地址。连着时做：一次热切换节点；一次策略 revision +1 重发；等 10 分钟。看服务日志里有没有准入拒绝。 | 已审应用走物理网卡（DIRECT），其余走出口，claude.ai 仍被拦。换核心进程这几秒 `ping` 不断，**不出现重连循环**（监视器不把这次换进程当崩溃）。热切换后连接保持，出口是新节点。正常的产品配置**不被准入拒绝**。失败时留在全隧道，证明不了隧道才放行普通网络、AI 仍拦。端口 8000 的直连不生效是已知问题 #1247。 | [#1175](https://github.com/raydocs/tono/pull/1175) [#1227](https://github.com/raydocs/tono/pull/1227) [#1245](https://github.com/raydocs/tono/pull/1245) [#1253](https://github.com/raydocs/tono/pull/1253) [#1257](https://github.com/raydocs/tono/pull/1257) [#1267](https://github.com/raydocs/tono/pull/1267) [#1188](https://github.com/raydocs/tono/pull/1188) [#1248](https://github.com/raydocs/tono/pull/1248) [#1281](https://github.com/raydocs/tono/pull/1281) |

### G. macOS helper 卸载与 AI 层清理

| ID | 类 | 平台 | 步骤 | 期望结果 | 覆盖 PR |
|---|---|---|---|---|---|
| G1 | 真机 | mac | 连着时退出 Tono，把 `Tono.app` 拖进废纸篓，等 30 秒，看 PF、DNS、`/etc/resolver` 和 `/Library/PrivilegedHelperTools/`。再执行 `--emergency-reset`（helper 已自删时跳过）。 | 删 App 后约 10 秒内 PF 放行，DNS 与基线一致，没有 AI 后缀文件；helper 随后自删。reset 后 `/etc/pf.conf` 没有 TONO 段。 | [发布就绪](../RELEASE_READINESS.md)「卸载时幂等恢复」 [#1222](https://github.com/raydocs/tono/pull/1222) [#1268](https://github.com/raydocs/tono/pull/1268) |
| G2 | VM（先快照） | mac | 用 C1(a) 让 AI 窄层在，然后 `sudo chflags schg /etc/resolver/claude.ai`。(a) 点「恢复网络」，等 30 秒，再 `sudo chflags noschg /etc/resolver/claude.ai`，等 30 秒。(b) 重新让 AI 窄层在并加 `schg`，退出 Tono 并删掉 `Tono.app`，等 30 秒看 helper；再去掉 `schg`，等 30 秒。 | (a) 普通网络一直能用。加锁期间文件留着；去锁后约 10 秒内 AI 后缀文件和黑洞路由都被删掉。(b) 删 App 后 PF 放行、DNS 恢复，但 **helper 仍在**（AI 层没删干净）；去锁后约 10 秒内 AI 文件被删，helper 随后自删。 | [#1283](https://github.com/raydocs/tono/pull/1283) [#1302](https://github.com/raydocs/tono/pull/1302) |
| G3 | VM | mac | 先备份。自建 `/etc/resolver/openai.com`（自定义内容），给系统装一个别的产品用的 `127.0.0.1` DNS 设置，再加一条非黑洞路由 `sudo route -n add -net 160.79.104.0/23 <局域网网关>`。连接，断开；再连接并用 C1(a) 触发自动放行，再点「恢复网络」。最后删掉自建的路由和文件。 | 自建的 `openai.com` 恢复成原内容、原权限，不被删；别的产品的 `127.0.0.1` DNS 设置保留；Tono 自己的 sinkhole 文件被清理。自建的 `160.79.104.0/23` 路由在连接、断开、恢复后**仍在**（`netstat -rn \| grep 160.79.104` 没有 `B` 黑洞标志）。 | [#1141](https://github.com/raydocs/tono/pull/1141) [#1154](https://github.com/raydocs/tono/pull/1154) [#1263](https://github.com/raydocs/tono/pull/1263) |

## 5. 已知未修 / 待老板决定

看到下面这些现象先对照，不要当新问题报。行为和描述一致就在记录里写「已知 #编号」。

- [#1303](https://github.com/raydocs/tono/issues/1303)（mac，P3）：登出时钥匙串删除失败、按账号的残留、AI 层删除挂起时 `--emergency-reset` 的行为。
- [#1305](https://github.com/raydocs/tono/issues/1305)（mac，P2）：helper 拒绝本 App 时的暂停会一直显示「保护离线」，即使看门狗已放行 PF。
- [#1307](https://github.com/raydocs/tono/issues/1307)（Win，P2）：更新恢复耗尽后没有修复路径，安装 / 更新 / 卸载在挂起期间都被拒。
- [#1308](https://github.com/raydocs/tono/issues/1308)（Win，P1）：更新处于 Consumed / Replaced / RolledBack 且没有可运行的执行者时，非严格启动屏障没有超时。
- [#1309](https://github.com/raydocs/tono/issues/1309)（Win）：重复的「退出」被拒后，取消退出可能留下 `is_exiting=true`。
- [#1300](https://github.com/raydocs/tono/issues/1300)（Win，P2）：无保护退出后再启动显示「保护离线（未知）」，下次退出要 UAC。
- [#1280](https://github.com/raydocs/tono/issues/1280)（Win）：sing-box DIRECT 准入只看形状，没有绑定签名策略。
- [#1284](https://github.com/raydocs/tono/issues/1284)（Win）：SCM Stop 可能在一次放行还在移除 WFP 时就关掉运行时。
- [#1290](https://github.com/raydocs/tono/issues/1290)（Win，P2）：第二个用户的 App 把别的用户的整机屏障当成自己的保护。
- [#1291](https://github.com/raydocs/tono/issues/1291)（Win，P2）：崩溃窗口的重连标志没有归属，另一个已登录用户的 App 可能自动连接并接管。
- [#1293](https://github.com/raydocs/tono/issues/1293)（Win，P3）：第 4 轮 IPC / 更新 / 多用户的 P3 汇总（含待老板决定和待实机回答的问题）。
- [#1296](https://github.com/raydocs/tono/issues/1296)（服务端）：出口节点 token 在用时被轮换，旧 agent 收到 401 后继续服务已装客户端，不再对账。
- [#1055](https://github.com/raydocs/tono/issues/1055)（Win）：更新 / 安装的未修 P2 边角（token 刷写、发布下限、回滚保持、延迟暂存、修复资源）。
- MAC-REMOVAL-RESOLVER-PARENT-SYMLINK（mac，P3，findings 片段随 #1302）：删 App 时的 AI 层检查只在最后一级拒绝符号链接；`/etc/resolver` 本身是符号链接时会跟进去读。只读、要 root，不是测试项。
- 另两条测试时容易碰到：[#1247](https://github.com/raydocs/tono/issues/1247)（Win，sing-box DIRECT 的 App 审核端口 `[80,443,8000,8080]` 和编译器 `{80,443,8080,8443}` 不一致，端口 8000 的直连可能不生效）；[MAC-QUIT-AI-HOLD](../findings.d/MAC-QUIT-AI-HOLD.md)（主动退出 / 断开删掉 AI 窄层，待老板决定）。

## 附录 A：CI 已覆盖或设备上无法安全触发（本轮不单独测）

2026-10-01 清单附录 A 里的 PR 仍按 CI 覆盖处理，不重复列。下面是之后合入的、主线条目只顺带走到正常路径的 PR：

- [#1216](https://github.com/raydocs/tono/pull/1216) 超时连接的迟到武装被补偿时保留 AI 层：要原生的超时与迟到提交时序，设备上无法稳定触发。
- [#1222](https://github.com/raydocs/tono/pull/1222) 删 App / reset 时 DNS 恢复失败保留 helper；被打断的显式 AI 清理续做：要注入 SCPreferences 争用或在窄窗口杀 helper。G1 走正常路径。
- [#1244](https://github.com/raydocs/tono/pull/1244) 四条卡 Blocked 的 Service / App 路径（owner 记录读错、启动对账持续失败、修复门 I/O 错误、登录抢占启动恢复）：要注入 I/O 错误。C14 走正常路径。
- [#1266](https://github.com/raydocs/tono/pull/1266) 未验证启动屏障退役失败时放行：要让退役 / DNS 恢复失败。C14 走正常路径。
- [#1268](https://github.com/raydocs/tono/pull/1268) 删 App 时旧核心杀不掉就保留 helper：要不可中断 I/O 的进程，设备上造不出来。
- [#1275](https://github.com/raydocs/tono/pull/1275) 自动 fresh-arm 退役在记账失败时仍放行：要 ACL / 杀毒占用造成持续写失败。
- [#1295](https://github.com/raydocs/tono/pull/1295) 显式 Release 在核心已停、记账失败时继续：同上。C15 走正常路径。
- [#1289](https://github.com/raydocs/tono/pull/1289) 更新 Prepare 拒绝无法发布的新成员：要特制的签名包。
- [#1188](https://github.com/raydocs/tono/pull/1188) [#1248](https://github.com/raydocs/tono/pull/1248) [#1281](https://github.com/raydocs/tono/pull/1281) Service 准入的**拒绝**路径（远程 rule-set、`0.0.0.0` 监听、`final` 改 direct、DIRECT 规则形状、经 selector 到 DIRECT）：要在 Service 启动前篡改配置，由 CI 准入测试覆盖。F4 只验证正常配置被接受。
- [#1267](https://github.com/raydocs/tono/pull/1267) DIRECT 主机名大小写合并：要后台发布大小写混用的策略；编译器单测覆盖，F4 走正常路径。
- [#763](https://github.com/raydocs/tono/pull/763) 的「删除 macOS 用户后 helper 启动失败也恢复 DNS」：要删用户，测试机上不安全。A5 测了它的 FIFO 和 `--emergency-disarm` 部分。
- [#1089](https://github.com/raydocs/tono/pull/1089) 系统装在 D: 盘时 AI 防火墙命令也能装：要专门装非 C 盘的 Windows，CI 覆盖。
- [#1232](https://github.com/raydocs/tono/pull/1232) exit-agent 列表超时仍按持久清单撤销：服务端，Services CI 覆盖。
- 2026-10-01 清单 W24（协议 18 / 19 Service 与 App 混搭）：协议 18 是从未发给客户的中间构建，不测；W26 的内容已并入 C 组（默认就是 sing-box）；W28 拒绝路径见上。
- 严格模式全阻断：两个平台都没有生产开关，由各 PR 单测覆盖。

## 附录 B：服务端（不归测试机，运维在预发 / 临时 VPS 做）

- S1 [#995](https://github.com/raydocs/tono/pull/995) [#996](https://github.com/raydocs/tono/pull/996) [#997](https://github.com/raydocs/tono/pull/997)：临时 VPS 开 HY2 节点并人为让部署失败回滚；目录同时有 DER 指纹和 SPKI pin，回滚后文件权限复原。
- S2 [#832](https://github.com/raydocs/tono/pull/832)：节点下线时排空等 HY2 用户。
- S3 [#1080](https://github.com/raydocs/tono/pull/1080) [#1170](https://github.com/raydocs/tono/pull/1170) [#1203](https://github.com/raydocs/tono/pull/1203)：下线与重新上架、退役与住宅绑定的并发不留下指向已退役节点的绑定。
- S4 [#1167](https://github.com/raydocs/tono/pull/1167)：退役后重新上架的 HY2 节点保留 SPKI pin。

## 附录 C：可选（记录数据，不判通过）

- [#422](https://github.com/raydocs/tono/issues/422)（5 分钟）：装了飞书 / Lark 的 Mac 上执行 issue 里的 `codesign -dvv …`，DMG 版和 App Store 版分开记，贴回 issue。
- [#331](https://github.com/raydocs/tono/issues/331)：「保护离线」时登出再登录并触发策略刷新，记录能否连上控制面。
- [#409](https://github.com/raydocs/tono/issues/409)（要两台 Mac）：迁移助理迁移后两台是否共用设备身份。
- [#1119](https://github.com/raydocs/tono/pull/1119) [#1121](https://github.com/raydocs/tono/pull/1121)（只影响显式 mihomo）：跨洋出口单连接吞吐；主用 DoH 被屏蔽后备用 DoH 只多约 40 ms。

## 记录方式

每项记：候选 SHA 和包哈希、OS 版本、开始和结束时间、实际结果、截图或日志位置。没做的写「未测」，不要写「通过」。日志和抓包放私有位置，不要贴进公开仓库。
