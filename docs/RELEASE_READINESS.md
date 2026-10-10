# 发布就绪差距（2026-09-30）

客户版从「大多能用」到可发布之前还缺什么。基线是 `main` `5c32a4b1`（已含 #704、#705、#707、#709、#727、#728、#732、#736）。开放 PR 以当天 `gh pr list` 为准。#706 仍开着，所以仪表盘「选择其他线路」先不删。

状态只用这几个词，一项可以同时占两个：

- `done`：源码已经在 `main`。不表示已签名、已发候选或已在客户机器上通过。
- `in-PR (#N)`：修复在该草稿或开放 PR 里，还没进 `main`。
- `needs-real-hardware`：PF / WFP / TUN / 睡眠 / HY2 / 卸载 / 退出路径必须在真机上再看一遍。托管 CI 证明不了。
- `later`：这一轮明确不做，等当前合入批（#700–#712、#733、#740、#703、#706、#714 / #715 / #720）落在 `main` 之后再开工。

总规则不变：不切断用户的网络。崩溃或卡住时先放行普通流量（fail open），除非用户自己打开了严格 Kill Switch。窄的 AI DNS / Claude 地址拦截不能以断网为代价。

本文不改 [SHIP_PLAN](SHIP_PLAN.md) §6 的勾选。G3 更新通道按所有者 2026-09-26 的决定放到 0.0.75。

## 一键退出并恢复网络

| 项 | 状态 | 说明 |
|---|---|---|
| 主窗口、托盘 / 菜单栏里始终可见的「退出并恢复网络」 | later；needs-real-hardware | 现有「退出」只是结束进程。菜单栏「恢复网络」只在保护已经挡住时出现。 |
| 界面或核心卡住时，进程外仍能恢复 | in-PR (#711)；needs-real-hardware | `main` 已有 macOS `sudo …/tono-core-helper --emergency-disarm` / `--emergency-reset`，以及 Windows 开始菜单「Tono — 恢复网络」。Windows 服务还握着 owner lock 时拒绝 disarm。macOS disarm 先 bootout 守护进程再放行，bootout 失败也照常放行（R3-O4，#1504）。#711 让坏账本不再挡住紧急恢复，DNS 恢复失败也放行 PF。#710 写明不做外部看门狗（`MAC-HELPER-HANG-WATCHDOG`）。#691 是 NO-GO，不算覆盖。 |
| 全局快捷键 | later；needs-real-hardware | 没有 PR 注册恢复用的全局热键。 |
| `tono --restore-network` | later | 现有旗是 `--emergency-disarm` / `--emergency-reset`，不是这个命令。 |
| 桌面快捷方式 | later；needs-real-hardware | 开始菜单快捷方式已在 `main` 的 Windows 安装器里（`done` 只指这段源码）。桌面图标还没有。 |
| 卸载时幂等恢复 | done（Windows 安装器源码）；in-PR (#710) (#701)；needs-real-hardware | Windows 卸载会跑 emergency-disarm，拦截没证明消失就不删文件。#733 在残留过滤器还在时保持完整 disarm。macOS 没有 pkg 卸载器；#710 在 App 被删掉而 helper 还在时大约每 10 秒放行 PF；#701 阻止开机从 `load anchor from` 装入阻断。新 helper 至少成功启动过一次之前，安全模式仍要手工 `pfctl` / `networksetup`。 |
| 崩溃、重启、安全模式 fail-open，以及看门狗 | in-PR (#701) (#708) (#710) (#712) (#733) (#740) (#738)；needs-real-hardware | 严格 Kill Switch 保持全拦截。macOS 睡眠屏障一旦成功，在重新 arm 之前仍然挡住（#708）。#738 在完全放行之后才允许窄的 AI 第二层，恢复 / 断开 / 紧急恢复会拿掉它。 |
| 退出超时后留下 PF / WFP | later；needs-real-hardware | macOS 退出清理大约 20 秒，超时明确不做 emergency-disarm。Windows 托盘退出在放行未证明时仍可能留下 WFP。没有开放 PR 把超时升级成恢复。 |

## 连接稳定性

| 项 | 状态 | 说明 |
|---|---|---|
| 出口已死，屏障还在 | in-PR (#706) (#714) (#715) (#720) (#703)；needs-real-hardware | #706 管耗尽后的 fail-open 和支持码（macOS 主要是连续隧道丢失）。#714 后台未武装探测，叠在 #706 上，macOS 未接线。#715 Windows 健康监视放弃时放行，叠在 #714 上。#720 macOS 武装失败后放行 PF，叠在 #706 上。#703 粘住同一出口，活屏障下不轮换，不替换住宅 SOCKS 身份，东京 hy2 不会自动跳。释放 IPC 失败仍可能留下屏障。 |
| 坞站 / 漫游闪断拆隧道 | in-PR (#702)；done（#705）；needs-real-hardware | #702：macOS 只在默认上行变化时重建，不因此放行 PF。#705 已在 `main`：Windows 先再探一次，第二次仍失败才停核心。 |
| 粘住同一服务器和住宅出口，不叫用户换网络 | in-PR (#703) (#706) (#714)；needs-real-hardware | 失败句里的「请重试或换节点」由 #706 拿掉。见下一行按钮。 |
| 仪表盘「选择其他线路」/ Choose another route | later | #706 还没合。合入之后再删 macOS `DashboardView` 和 Windows `switchRoute`。本清单不提前改。 |
| 可诊断的支持码 | in-PR (#706) | 含 QUIC 阶段。#722 只共享阶段计时的键，in-PR (#722)。 |
| HY2 / QUIC 住宅 NAT 空闲 | in-PR (#749)；needs-real-hardware | sing-box 出站写 `keep_alive_period: 5s`，不改空闲超时，不关 Chrome parrot。mihomo 没有字段，核心内部仍是 10 秒保活 / 30 秒空闲（[HY2-IDLE-MIHOMO](findings.d/HY2-IDLE-MIHOMO.md)）。空闲记 `TONO_CONNECT_HY2_IDLE`，不要求换节点。#704 已在 `main`：不发 `handshake-timeout`。#718 / #714 / #720 的 TCP 预检跳过 HY2。 |
| DNS | in-PR (#741) (#712) (#706) (#744)；needs-real-hardware | #741：出口 DoH 离开首包、复用、fake-ip TTL 30。#712：只恢复快照里的 DNS。#706：登录时的大陆 DoH 竞态。#744：macOS sing-box DNS 形状对齐 Windows。#742 记下剩余缺口（没有 TTL 字段、只有一个 DoH）。 |
| 第一次连接在装隧道前证明 TCP | in-PR (#718)；needs-real-hardware | 只覆盖 VLESS。HY2 的 UDP 静默丢包没有覆盖。 |
| `/delay` 不占第一次握手 | done（#736）；in-PR (#741)；needs-real-hardware | #736 已在 `main`。DoH 离开关键路径是 #741。 |
| 有限广播进 TUN | in-PR (#700)；needs-real-hardware | 不改变恢复。 |
| 住宅 SOCKS 同一出口自愈 | later；needs-real-hardware | 没有 PR 在原地重试一条死掉的住宅 SOCKS，并给它单独的支持码。 |

## 发布体验和其他

| 项 | 状态 | 说明 |
|---|---|---|
| 首次引导收成一屏 | in-PR (#717) | 权限和 helper 提示不在这条里。 |
| 托盘里的恢复入口 | later；needs-real-hardware | 和一键退出同一批，本轮不动托盘 / 退出代码。 |
| 只改显示的托盘和仪表盘 | in-PR (#719) (#723) (#726) (#731) (#735) (#739) | 不碰拦截，也不等于恢复网络。 |
| sing-box 当客户核心 | in-PR (#729) (#730) (#744) (#742) | 不是这次的发布开关。默认仍是 mihomo。#729 才让 Windows 产品 JSON 写出 HY2 的 DER 钉。 |
| 诊断上传默认重新打开 | in-PR (#724) (#725) | 隐私边界见 [diagnostics stay on](decisions/002-2026-09-30-diagnostics-default-on.md)。不是连接稳定性修复。 |
| G3 更新通道 | later（0.0.75） | 所有者已决定。本文不改 SHIP_PLAN §6。 |
| 运维控制台 | in-PR (#743) (#745) (#746) (#747) (#748) (#737) (#734) (#716) (#713) | 不是客户启动门。 |
| Linux Cloud Agent 的检查范围 | in-PR (#699) | 只约束代理在哪台机器上跑测试。 |

## 这一轮明确不做

等合入批落到 `main` 之后再做，不要插进正在合的 PR：

1. 一键「退出并恢复网络」（主窗口、托盘、全局快捷键）。
2. `tono --restore-network`，以及能先停掉活着的服务 / helper 再 disarm 的桌面快捷方式。
3. 退出超时升级成恢复，而不是留下 PF / WFP。
4. 住宅 SOCKS 同一出口自愈（单独支持码）。
5. 删掉「选择其他线路」。只在 #706 已经合入 `main` 之后做。

#715 和 #734 只读，不改。

## 实机还要看的

上面凡是标了 `needs-real-hardware` 的都算。优先：

- 崩溃、重启、安全模式、睡眠之后，普通流量是否回来；严格模式是否仍全拦截。
- 退出超时、卸载、开始菜单「恢复网络」在服务还活着时是否真的放行。
- 住宅网络上 HY2 空闲超过一分钟后，sing-box 的 5 秒保活是否还在；mihomo 的 10 秒是否不够。
- 坞站插拔和 Wi-Fi 闪断是否只重建该重建的隧道。
