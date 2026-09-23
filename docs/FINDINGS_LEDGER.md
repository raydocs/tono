# Tono 发现总账（Findings Ledger）

这是**唯一的已知问题总账**。每一轮审查、核实、修复开始前先读它，用它去重，
不再每轮手工粘贴 known-findings。它回答「这个问题有没有人报过、现在是什么状态、
还剩什么限制」。它不取代 [INTERNAL_CHANGELOG](INTERNAL_CHANGELOG.md)（交付和验证记录）、
[SHIP_PLAN](SHIP_PLAN.md)（发布门）或 GitHub issue/PR 正文（详细分析）。

## 维护规则

- **同 PR 更新**：每个修复 PR、审查 PR 都要同步更新对应条目的状态和链接。
  新发现加新行；开出 issue/PR 后把「待开」改成真实编号。
- **驳回的也要留一行**：被核实推翻、撤回或排除的结论记为 `refuted`，写一句依据，
  防止以后重复上报。重报必须给出推翻依据失效的新反例。
- **状态值只有五种**：
  - `open`：确认或推导成立，尚无合入 main 的修复（可能已有 issue 或工作分支）。
  - `in-PR`：修复 PR 已开，尚未合入 main。
  - `fixed(<main SHA>)`：修复源码已进入 main，SHA 是合入 main 的提交。**只表示源码进 main**，
    不表示签名、候选包、实机验收或客户发布。
  - `refuted`：核实推翻、撤回或排除。
  - `accepted-design`：有意设计或已记录的取舍，不作为缺陷修。
- **等级**写成「影响·核实度」。影响：高 = 流量/身份泄漏、越权、跨账户串扰、保护已解除却显示已保护；
  中 = 产品内锁死、保护状态失真（仍 fail-closed）、自愈缺失；低 = 显示、体验或前提很窄。
  核实度：已确认 / 推导（源码推导）/ 实机（需实机验证）。
- **ID 保留原编号**：首轮 W/M/S；审查轮 R1–R4（`R<块>-F<n>`，`R3-O<n>` 为观察项）；
  隐秘 bug 搜寻 H1–H4（`H<块>-F<n>`）。首轮之后的零散修复用 I（安装/易用性）与
  N（连接等待/DNS）；撤回/排除用 X；已交付结构与设计取舍用 D。
- **安全类条目**（数据面泄漏、特权、越权）只写缺失的约束与影响，不写复现命令或绕过手法；
  详细分析留在 issue/内部报告。仓库是公开的。
- 同一根因的续修、移植、补测试、cherry-pick 不算新条目，在原行「剩余限制」或链接里补充。
- 工程/测试/文档修正（CI 覆盖、fixture、编译错误、截图等）不进本账，见 INTERNAL_CHANGELOG。
- 方法与覆盖范围见 [2026-09-23 审查轮记录](reports/REVIEW_ROUNDS_2026-09-23.md)。

状态快照：2026-09-23，origin/main `b1b6fe6c`（已含 #294–#297、#299、#302；#312 已关闭）。
其余 R 系列 PR 正在串行合并，H 系列修复 PR 陆续开出；表中编号为写入时 GitHub 的真实状态。

## 1. macOS 连接

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| M1 | AppState 因 Core 停止失败保留保护，AccountSession 第二个 owner 仍恢复 DNS、解除 PF | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267)（含 #268） | 中·已确认 | AppState 为唯一释放 owner；实机未覆盖全部失败组合 |
| M3 | audit 写盘失败无界回填 | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 低·已确认 | 上限 256 条/256 KiB，超出部分本地丢弃并记录 |
| I5 | 验证期间同名目录被替换，旧 digest 的成功记给新目录 | fixed(569ce865) | [#279](https://github.com/raydocs/tono/pull/279) | 低·已确认 | — |
| R1-F1 | 切节点/热重载/后台策略重启 sing-box 的 utun 瞬时空窗被健康监视判为 TUN stopped，正常切换变成断开+重连 | in-PR | [#298](https://github.com/raydocs/tono/pull/298) | 中·已确认 | 空窗时长与命中率需实机；原报告「三次暂停」一句不成立（见 X8） |
| R1-F2 | 睡眠落在 Restore internet 期间：显式释放被改写为保留保护+唤醒重连；PF 未 armed 时仍宣告 Protected Offline | in-PR | [#310](https://github.com/raydocs/tono/pull/310) | 中·已确认 | 睡眠通知次序需实机；后续改用 helper 真值见 R1-N1 |
| R1-F3 | PF 未 arm 时到达的策略更新拆掉连接后，重连 loop 把「从未 armed」当外部释放，Connect 意图丢失 | in-PR | [#304](https://github.com/raydocs/tono/pull/304) | 中·已确认 | 与 R1-F4 非同根因 |
| R1-F4 | 连接后后台可选策略替换失败只断开不调度重连，停在 Protected Offline | in-PR | [#306](https://github.com/raydocs/tono/pull/306) | 中·已确认 | — |
| R1-F5 | 连接/断开进行中的系统网络变化通知被丢弃，最长 60 s 后才由审计发现（W8 的 macOS 遗漏） | in-PR | [#309](https://github.com/raydocs/tono/pull/309) | 低·已确认 | 审查要求断开分支不得把自写 DNS 当外部变化回放 |
| R1-F6 | 连接中选择另一节点，完成时被 core 实际选择覆盖回旧节点 | open | [#312](https://github.com/raydocs/tono/pull/312)（已关闭） | 低·已确认 | 生产卡片连接中已禁用，仅同帧竞争可触发；#312 的修法在后台策略重载进行中时更差，已关闭，暂不修 |
| R1-N1 | #310 判「未 armed」用 App 本地状态，应改用 helper 真值，仅确认为 false 才发布非 blocked | open | 待开 | 低·推导 | #310 审查附注，未做 |

## 2. Windows 连接

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| W1 | 重试任务槽位被覆盖，旧句柄丢失但 loop 继续 | fixed(0e20f2df) | [#247](https://github.com/raydocs/tono/issues/247)，[#267](https://github.com/raydocs/tono/pull/267) | 中·已确认 | — |
| W3 | 节点页/托盘用旧 idle 状态，在后端已接受热切换后追加 Connect | fixed(0e20f2df) | [#251](https://github.com/raydocs/tono/issues/251)，[#267](https://github.com/raydocs/tono/pull/267) | 中·已确认 | admission 残余竞态见 I6 |
| I6 | #251 续：读取 idle 后、Connect admission 前另一窗口已连接，本窗口报错/托盘不刷新 | fixed(ac2cde16) | [#281](https://github.com/raydocs/tono/pull/281) | 低·已确认 | 只协调已识别的 Connect 竞争拒绝 |
| W4 | 登出进行中调用者消失，关闭责任提前结束并重开连接 admission | fixed(0e20f2df) | [#248](https://github.com/raydocs/tono/issues/248)，[#267](https://github.com/raydocs/tono/pull/267) | 中·已确认 | — |
| W5 | 断开调用者取消后会话时钟、重试元数据未收尾 | fixed(0e20f2df) | [#246](https://github.com/raydocs/tono/issues/246)，[#267](https://github.com/raydocs/tono/pull/267) | 低·已确认 | — |
| W6 | A 验证迟到，覆盖 B 的 controller secret/port | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 中·已确认 | — |
| W9 | 下一次重试清空上次失败原因/代际/阶段 | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 低·已确认 | — |
| W10 | 55 s UI 等待超时被当成释放已结束，提前重开 admission | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 中·已确认 | — |
| W14 | A 连接失败等 Service status 期间 B 登录，失败归给 B | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 中·已确认 | — |
| I4 | Activity 把只有 selector 的链当作已观测终端出口 | fixed(569ce865) | [#279](https://github.com/raydocs/tono/pull/279) | 低·已确认 | — |
| #241 | 过期策略恢复在拆除期间借用替换中的 Core 会话 | fixed(基线 576d7087 已含) | [#241](https://github.com/raydocs/tono/issues/241) | 中·已确认 | issue 保持开放等设备证据 |
| #171 | 热切换端点收敛失败时两端都必须撤回 Connected | open | [#171](https://github.com/raydocs/tono/issues/171) | 中·实机 | 两端；需原生验收 |
| R2-F1 | Disconnect/登出与进行中的 StartClash 竞争且释放被拒：UI 报 Not Connected 而 WFP 仍封锁，Disconnect 成空操作 | fixed(3d957265) | [#295](https://github.com/raydocs/tono/pull/295) | 中·已确认 | 含登出第二路径；实机未复现 |
| R2-F2 | 未验证 Protected Offline 期间 Service 重启解除 WFP，App 无再同步，UI 持续显示已封锁 | fixed(244075f2) | [#299](https://github.com/raydocs/tono/pull/299) | 高·已确认 | 30 s 轮询；已验证会话进入 idle 且未排程重连时不注册轮询；无「Service 重启+存活 App」实机夹具 |
| R2-F3 | 原生更新安装落在连接早期，失败后 FSM 卡在 Connecting | fixed(16032c48) | [#294](https://github.com/raydocs/tono/pull/294) | 中·已确认 | 收敛前比对代际；实机未复现 |
| R2-F4 | monitor 驱动重连成功后 abort 了正在跑连接尾部的自身任务 | fixed(49c82dde) | [#296](https://github.com/raydocs/tono/pull/296) | 低·推导 | 实际损失为本会话 DIRECT 覆盖缺失与 UI directOn 失真 |
| R2-F5 | 连接中到达的策略行为变更被丢弃，本会话不应用 DIRECT | fixed(da7bad1b) | [#297](https://github.com/raydocs/tono/pull/297) | 低·已确认 | 「UI 显示直连已开」被驳回（X9）；pending 变更须随 Disconnect/换账户清除（二轮修正） |
| R2-F6 | 被取消 attempt 的 PrepareCoreStart 迟到，可停掉后继未验证 Core | fixed(b1b6fe6c) | [#302](https://github.com/raydocs/tono/pull/302) | 中·实机 | 协议 rev 16→17；旧 App + 新 Service 兼容按二轮修正处理；实机未复现 |

## 3. DNS（两端）

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| W2 | 卸载时 NRPT 恢复失败被适配器 fallback 吞掉，误报已恢复 | fixed(0e20f2df) | [#249](https://github.com/raydocs/tono/issues/249)，[#267](https://github.com/raydocs/tono/pull/267) | 中·已确认 | issue 开放等设备/系统边界证据 |
| W8 | Windows DNS 自写窗口内直接丢弃网络通知 | fixed(0e20f2df) | [#259](https://github.com/raydocs/tono/issues/259)，[#267](https://github.com/raydocs/tono/pull/267) | 中·已确认 | issue 开放等设备证据；macOS 对应项 R1-F5 |
| M2 | macOS DNS 读取失败当作空配置，删除快照并允许释放 | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267)（含 #268） | 中·已确认 | 「拒绝假恢复」是后续 DNS 修复的约束基线 |
| N1 | macOS getaddrinfo 阻塞在 task group 内 | fixed(1ca878cf) | [#289](https://github.com/raydocs/tono/pull/289) | 中·已确认 | — |
| N2 | macOS DNS-SD 同步提交阻塞，timer/cancel 共用队列，旧请求未清理即堆叠 | fixed(1ca878cf) | [#289](https://github.com/raydocs/tono/pull/289) | 中·已确认 | 无确定性挂住 deallocate 的回归 |
| N3 | macOS listener NWConnection 构造期取消丢失 | fixed(1ca878cf) | [#289](https://github.com/raydocs/tono/pull/289) | 低·已确认 | — |
| N4 | listener 接受不匹配问题/无关 owner/CNAME/错误或截断应答仍产生 fake-IP 证明 | fixed(1ca878cf) | [#289](https://github.com/raydocs/tono/pull/289) | 中·已确认 | 无 parser fuzz |
| N5 | listener 读到 fake-IP 后续 RR 畸形仍保留正面结果 | fixed(1ca878cf) | [#289](https://github.com/raydocs/tono/pull/289) | 中·已确认 | — |
| N6 | listener 忽略 OPT 扩展 RCODE | fixed(1ca878cf) | [#289](https://github.com/raydocs/tono/pull/289) | 低·已确认 | — |
| N7 | Windows 适配器消失被合成为 apply 成功 | fixed(1ca878cf) | [#289](https://github.com/raydocs/tono/pull/289)（含 #290） | 中·已确认 | 未证明 WFP 被绕过；夹具未跨真实 DLL |
| N8 | Windows IPv4 已写、IPv6 失败时无 pending，下一次被当作已配置 | fixed(1ca878cf) | [#289](https://github.com/raydocs/tono/pull/289)（含 #290） | 中·已确认 | 同上 |
| N9 | Windows 快照损坏时混合 DNS（公共 + TUN 地址）被漏判，错误接受恢复 | fixed(576d7087) | [#293](https://github.com/raydocs/tono/pull/293) | 中·已确认 | — |
| R3-F1 | Windows 快照存在时，已带 TUN DNS 地址的新/重激活适配器被记为原始 DNS；损坏快照恢复只读 active 适配器，Disconnect 永久被拒 | in-PR | [#300](https://github.com/raydocs/tono/pull/300) | 中·已确认 | 区别于 N9；验收机需核实 wintun 删除后接口键残留 |
| R3-F2 | Windows 加密 DNS 旁路捕获文件非原子落盘，损坏后释放永久硬拒 | in-PR | [#305](https://github.com/raydocs/tono/pull/305)（叠在 #300 上） | 中·推导 | 需持久记录隔离证据；文件跨卸载存活 |
| R3-F3 | macOS `protected-dns.json` 损坏/权限异常时 restore、紧急解除、卸载、启动清理全被阻 | in-PR | [#307](https://github.com/raydocs/tono/pull/307) | 中·推导 | 审查要求：DNS 恢复失败时紧急出口不得顺带拆 PF（M2） |
| R3-F4 | macOS status() 把「快照有效但服务不可读」报成无快照，App 不再调用 restore | in-PR | [#303](https://github.com/raydocs/tono/pull/303) | 低·已确认 | helper 契约版本级联（4.6.0 起） |
| R3-O1 | Windows 恢复证明通过后删快照失败即拒绝拆 WFP，重试同样失败（ACL/AV 锁文件） | open | 待开 | 低·推导 | 观察项，未核实 |
| R3-O2 | Windows 外层超时丢弃 restore future 时自写窗口提前关闭，自写通知被当外部变化 | open | 待开 | 低·推导 | 观察项；影响为多一次网络事件 |
| R3-O3 | 无快照时把静态 DNS 改为 DHCP 的孤儿修复 | accepted-design | — | 低 | 有意取舍 |
| R3-O4 | macOS `--emergency-disarm` 不先 bootout daemon，与在线 daemon 双写 | open | 待开 | 低·推导 | 观察项；操作员手动路径 |
| R3-O5 | macOS 按名字取第一个网络服务，多 Network Location 同名时可能写错服务 | open | 待开 | 低·实机 | 观察项 |
| R3-O6 | Windows 卸载器在 owner lock 不可得且无 pid 文件时仍 disarm，可能与存活 Service 并发写 DNS | open | 待开 | 低·推导 | 观察项 |
| R3-O7 | 无快照守卫只认 TUN 地址，旧版遗留 127.0.0.1 被当作用户本地解析器 | accepted-design | — | 低 | 有意取舍，源码有注释 |

## 4. 升级事务与候选安装

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| M4 | macOS 更新日记用旧 Mihomo 版本/build number 冒充 Core/源码身份 | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 低·已确认 | — |
| I1 | Windows 覆盖安装使用盘符相对路径 `C:Users` | fixed(f1c1c9d9) | [#276](https://github.com/raydocs/tono/pull/276) | 中·已确认 | — |
| I2 | macOS 候选签名准入固定在 0.0.72 | fixed(f1c1c9d9) | [#276](https://github.com/raydocs/tono/pull/276)，[#273](https://github.com/raydocs/tono/issues/273) | 中·已确认 | #273 开放：最新分支的新包/已装 helper 资格未建立 |
| I3 | macOS 签名链同一 run 重复生产同名 Core artifact | fixed(f1c1c9d9) | [#276](https://github.com/raydocs/tono/pull/276) | 低·已确认 | — |
| #26 | Windows 受保护升级需安装器绑定的交接身份和装机证明 | fixed(1ca878cf) | [#26](https://github.com/raydocs/tono/issues/26)（已关闭） | 高·实机 | 协议源码已接入；已装 macOS/Windows 11 的升级/中断恢复实机验收仍缺 |
| #181 | 共享更新日记临时文件可被并发写坏 | open | [#181](https://github.com/raydocs/tono/issues/181) | 低·推导 | — |
| R4-F1 | Windows 更新事务权限绑定单一 App incarnation，发起 App 退出/被杀/回滚后所有出口被拒 | in-PR | [#301](https://github.com/raydocs/tono/pull/301) | 中·已确认 | 与 F4/F6 同根因合修；对 0.0.73 首跳不生效 |
| R4-F4 | Windows 恢复执行器把「Replaced 且 successor 不活」一律当中断安装回滚，撤销完整安装 | in-PR | [#301](https://github.com/raydocs/tono/pull/301) | 中·已确认 | 慢机服务就绪超时是第三个入口 |
| R4-F6 | Windows Launching 且执行器登记为空/已死的事务既不退休也不对账 | in-PR | [#301](https://github.com/raydocs/tono/pull/301) | 中·已确认 | 网络可在产品内恢复，锁死的是产品本身 |
| R4-F7 | Windows Replaced + 已验证 Disconnect 后事务永久 pending，连接/再更新/卸载全被拒 | open | 待开 | 中·推导 | 需设计「已安装+已释放」归档终态；非 #301 引入 |
| R4-F8 | Windows 恢复判定与已回滚退休只校验三个二进制，不校验整份 durable plan | open | 待开 | 中·推导 | 安装完整性缺口，无保护绕过 |
| R4-F2 | macOS consumed 后未到 replaced 的事务无终态，helper 永久拒绝启动/新 offer/修复 | in-PR | [#311](https://github.com/raydocs/tono/pull/311) | 中·已确认 | 与 F3 合修；helper 契约 4.9.0 |
| R4-F3 | macOS successor 绑定唯一 audit token 无再收养，执行器 relaunch 的新实例也被拒 | in-PR | [#311](https://github.com/raydocs/tono/pull/311) | 中·已确认 | 原报告对现有收养能力的描述不成立（X10） |
| R4-F5 | macOS 开机时 helper KeepAlive 重启与执行器停止 daemon 交错，startup 抛错触发紧急 PF 阻断 | in-PR | [#308](https://github.com/raydocs/tono/pull/308) | 低·推导 | 受保护义务可自愈；仅 `.unprotected` 义务落入 R4-F2 |

## 5. 控制面（Worker）

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| H4-F1 | dual 阶段吊销设备不退役共享 legacy 出口凭据，被吊销设备仍可用出口并计入账户 | in-PR | [#313](https://github.com/raydocs/tono/issues/313)，[#323](https://github.com/raydocs/tono/pull/323) | 高·推导 | 暴露面取决于生产 rollout phase（本机无法查） |
| H4-F2 | 停用/退役/删除/改名的住宅（catalog 型）home exit 及其 hy2 孪生块从限制名单掉出，下发给所有账户 | in-PR | [#322](https://github.com/raydocs/tono/issues/322)，[#326](https://github.com/raydocs/tono/pull/326) | 高·推导 | roster 不按节点隔离（身份隔离）列为后续 |
| H4-F3 | ops 角色门不覆盖 shared-admin；另有原始日志读取与 signup-allowlist 写两处未拦截且文档未列 | open | 待开 | 低·推导 | shared-admin 不拦截是已记录限制；只有配置 OPS_ROLES 且有非 owner 角色时可利用 |
| H3-F4 | refresh 严格单次轮换无宽限且非原子：响应丢失即产生伪 401，客户端登出并释放保护 | in-PR | [#314](https://github.com/raydocs/tono/issues/314)，[#329](https://github.com/raydocs/tono/pull/329) | 高·推导 | 修复在服务端，客户端「真 401 才释放」不变 |
| H3-F5 | 策略 revision 不在签名字节内，历史签名策略配伪造 revision 可永久钉住客户端 | in-PR | [#317](https://github.com/raydocs/tono/issues/317)，[#342](https://github.com/raydocs/tono/pull/342)（Windows） | 中·推导 | 前提是 Worker/D1 被攻破或 TLS 中间人；发布脚本、Worker、macOS 仍需同改 |

## 6. 客户端信任与账户隔离

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| W7 | A 的 logout 响应迟到，撤销/删除 B 的凭据 | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 高·已确认 | — |
| W11 | restore 401 检查代际后账户被替换，旧操作清理新账户 | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 高·已确认 | — |
| W12 | 异步凭据写入/删除乱序，复活已退出令牌或抹掉新令牌 | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 高·已确认 | 进程被杀时未落盘的新 refresh 仍会丢（见 H3-F4） |
| W13 | A 的请求 401 后刷新借用 B 的凭据重放 | fixed(0e20f2df) | [#267](https://github.com/raydocs/tono/pull/267) | 高·已确认 | — |
| H3-F1 | Windows 登出不丢弃账户专属目录，且同 revision 不同 digest 被当篡改：下一账户沿用上一账户的出口身份与住宅凭据 | in-PR | [#315](https://github.com/raydocs/tono/issues/315)，[#316](https://github.com/raydocs/tono/pull/316) | 高·已确认 | 同账户设备重发 UUID 变体同修；不是本机流量泄漏 |
| H3-F2 | Windows 不识别只改 routing 的轮换（routingSha256），解绑/换绑/轮换凭据后继续用旧 routing | in-PR | [#321](https://github.com/raydocs/tono/issues/321)，[#324](https://github.com/raydocs/tono/pull/324) | 中·已确认 | macOS 已修 |
| H3-F3 | Windows 换账户后首个 periodic telemetry 窗口上传上一账户的审计事件 | in-PR | [#319](https://github.com/raydocs/tono/issues/319)，[#320](https://github.com/raydocs/tono/pull/320) | 中·推导 | 需 telemetry 同意开启 |
| H3-F6 | Windows 接受未签名策略的 media 端点，macOS 同一文档全部丢弃 | in-PR | [#318](https://github.com/raydocs/tono/issues/318)，[#340](https://github.com/raydocs/tono/pull/340) | 低·已确认 | Worker canonical 也应要求签名 |
| D5 | 控制面 TLS 只做 DNS pin，无证书/SPKI 固定 | accepted-design | — | — | 依赖系统信任库；被信任的中间人 CA 可伪造目录/策略/refresh |
| D6 | hy2 第二块与主块身份一致只由 Worker 保证，客户端只按名称后缀识别 | accepted-design | — | — | 目录本来只有 TLS 信任边界（见 X4） |

## 7. 数据面规则（PF / WFP / sing-box / mihomo）

以下 H1 条目均为源码推导，没有实机复现。只记缺失约束与影响。

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| H1-F1 | macOS Continuity 直连规则只按进程名匹配，未绑定受保护路径或代码身份；直连策略活动时，非预期进程的 web 端口流量可能经物理接口出去 | in-PR | [#325](https://github.com/raydocs/tono/issues/325)，[#327](https://github.com/raydocs/tono/pull/327) | 高·推导 | Windows 侧已明确不按进程名直连 |
| H1-F2 | macOS reviewed 直连的默认安装路径不校验存在性与签名即授予路径前缀；Windows 对用户可写的官方布局目录授予前缀 | in-PR | [#332](https://github.com/raydocs/tono/issues/332)，[#336](https://github.com/raydocs/tono/pull/336)（macOS）；[#333](https://github.com/raydocs/tono/issues/333)（Windows，PR 待开） | 高·推导 | Windows 变体未修；运行时按路径匹配仍依赖目录不可写 |
| H1-F3 | Windows TLS 嗅探对裸 IP 生效，与无 IP/进程条件的域名后缀直连规则组合，直连目的不受 pinned 地址约束 | in-PR | [#338](https://github.com/raydocs/tono/issues/338)，[#339](https://github.com/raydocs/tono/pull/339) | 高·推导 | 依赖 mihomo 嗅探语义，需实机；macOS 无嗅探，行为不同 |
| H1-F4 | Windows WFP 只在出向授权层阻断，入向接受层无 block-all，外部发起的入向流不经隧道也不被阻断 | open | [#328](https://github.com/raydocs/tono/issues/328) | 高·推导 | 修复分支进行中、PR 待开；全局 IPv6 场景最现实；macOS PF 行为不同 |
| H1-F6 | 两端 DHCP 放行只按端口，不限目的地址、接口和进程 | open | [#341](https://github.com/raydocs/tono/issues/341) | 中·实机 | 取决于非特权进程能否占用 DHCP 客户端端口 |
| D7 | macOS 连接中 `tono-lan` 对私网任意端口、任意用户放行 | accepted-design | — | — | 设计残留，Windows 无此放行；应写入文档 |

## 8. 特权边界

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| H1-F5 | bootstrap/恢复控制面放行未绑定 Tono 程序身份（Windows permit 无 AppId；macOS PF 只能按 UID），Protected Offline 期间非 Tono 进程也能到达共享 anycast 地址 | in-PR | [#330](https://github.com/raydocs/tono/issues/330)，[#334](https://github.com/raydocs/tono/pull/334)（Windows）；[#331](https://github.com/raydocs/tono/issues/331)，[#335](https://github.com/raydocs/tono/pull/335)（macOS，仅把注释改为 UID 边界） | 中·推导 | macOS PF 无法表达程序身份，#335 只修正描述，程序身份约束仍缺（需 helper 代理或记为风险） |
| H2-F1 | macOS helper 静默升级路由缺版本下限、签名要求弱于安装器、候选未绑定请求方 App 封存资源，可无管理员同意换成旧版或开发版 helper/核心 | open | [#337](https://github.com/raydocs/tono/issues/337) | 中·推导 | 从下一个 helper 版本起才有可回滚目标；封存绑定是否可达需实机 |
| H2-F2 | Windows StartClash 不检查已武装 WFP 的 owner，另一名交互式用户可接管后释放他人保护 | open | 待开 | 高·推导 | 需产品决定多用户语义；受害方 UI 表现需实机 |
| H2-F3 | Windows Service 只认证用户（SID + token 文件）不认证 Tono 映像，特权端也不校验 runtime YAML；macOS 对同一威胁有签名与配置白名单 | open | 待开 | 高·推导 | 是否在威胁模型内需所有者确认；映像校验已存在但只用于更新路由 |
| H2-F4 | Windows runtime asset 校验与复制不在同一句柄，复制按路径重开并跟随 reparse point | open | 待开 | 低·推导 | 未确认有把复制内容回显出去的渠道 |

## 9. 计量与 ops

| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| S1 | Python/Worker 密码脱敏只替换标签，值仍进入存储结果 | fixed(0e20f2df) | [#269](https://github.com/raydocs/tono/issues/269)，[#267](https://github.com/raydocs/tono/pull/267)（含 #271） | 中·已确认 | 反例用合成凭据，不声称真实泄漏 |
| S2 | SSH rc255、journal rc1 被报为成功观测 | fixed(0e20f2df) | [#270](https://github.com/raydocs/tono/issues/270)，[#267](https://github.com/raydocs/tono/pull/267)（含 #271） | 中·已确认 | — |
| #4 | legacy/named 计量切换在安静窗口内放过增长 | open | [#4](https://github.com/raydocs/tono/issues/4) | 中·已确认 | 没有生产切换 |
| #5 | home-agent 无法识别高于旧水位的计数器重置 | open | [#5](https://github.com/raydocs/tono/issues/5) | 中·已确认 | — |
| OPS-1 | ops 观测表达/freshness 后续项 | open | [ops 计划](ops/plan-2026-09-11.md) | 低 | 不是客户发布门 |
| #208 | 定时 D1 备份在导出前因缺 Cloudflare 凭据失败 | open | [#208](https://github.com/raydocs/tono/issues/208) | 中·已确认 | — |
| #191 | D1 当月冲销警告需吸收且不覆盖 Batch 8 Ledger | open | [#191](https://github.com/raydocs/tono/issues/191) | 低 | — |
| #188 | #187 集成被 Batch 8 UI 冻结与 migration 0072 冲突阻塞 | open | [#188](https://github.com/raydocs/tono/issues/188) | 低 | — |
| #183 | Today 之外 18 个既有 Mac 截图失败待对账 | open | [#183](https://github.com/raydocs/tono/issues/183) | 低 | 测试/fixture 类 |

## 10. 已撤回 / 已排除（refuted，勿重报）

| ID | 结论 | 状态 | 依据 |
|---|---|---|---|
| X1 | 「macOS logout 一定保留旧 managed catalog」 | refuted | macOS 登出会清理/重新认领 managed catalog；Windows 的对应问题是 H3-F1，另一根因 |
| X2 | 旧 updater cache-install 文件是生产漏洞 | refuted | 未确认生产可达；重报须给出当前可达调用链 |
| X3 | TLS EOF 说明封锁/UUID/Reality 错误；UUID 格式正确说明 roster 已接纳 | refuted | 两者都不能由该证据推出 |
| X4 | catalog 有 Ed25519 签名 | refuted | catalog 是加密 + SHA-256 完整性边界，只有流量策略有 Ed25519；digest 无密钥，不防伪造 |
| X5 | Windows native setter 返回成功、注册表看起来受保护、空 IPv6 输入可证明 DNS 有效 | refuted | 这些都不单独证明有效 DNS，必须读回 |
| X6 | 超时后后台仍保留阻塞 OS 调用和 claim 是泄漏 | refuted | 有意的 fail-closed 设计 |
| X7 | CI 绿 / issue 关闭 / 进 main / 签名 / 设备通过 / 客户发布可以互相替代 | refuted | 是不同事实，分别记录 |
| X8 | R1-F1 附带的「三次暂停」说法 | refuted | 该计数只在 connect 失败路径递增 |
| X9 | R2-F5 附带的「UI 显示直连已开」 | refuted | 先写入 optional_direct_skip，UI 如实显示 directSkipped |
| X10 | R4-F3 原报告称 propose 已支持 adopting | refuted | 核实不成立，最小修复在适配器层重绑 |

## 11. 已交付的结构与优化（accepted-design，勿报「未实现」）

| ID | 内容 | 状态 | 说明 |
|---|---|---|---|
| D1 | Windows 原生 SetInterfaceDnsSettings + IPv4/IPv6 有效读回；未验证成功的原生调用进一次兼容批次并重读全部相关适配器；facade 超时不清除 worker 单写者 claim | accepted-design | [#289](https://github.com/raydocs/tono/pull/289)；不是提速证据 |
| D2 | macOS 最后一轮 mixed 诊断与 TUN 探测并行；迟到/取消结果不改新连接偏好或遥测；mixed/controller 成功不能替代 TUN 成功 | accepted-design | [#289](https://github.com/raydocs/tono/pull/289) |
| D3 | 原生升级 v1：canonical manifest 绑定两端包、摘要、签名 releaseSequence；root helper / SYSTEM 独立执行器；私有暂存、消费前持久化、单次消费、successor 身份、回滚、高水位保留 | accepted-design | [#282](https://github.com/raydocs/tono/pull/282) 模型、[#283](https://github.com/raydocs/tono/pull/283) 接入，经 #289 进 main；不代表受保护装机升级已验收 |
| D4 | Disconnect 不伪造恢复/提交，不删除已消费或不确定事务；保留证据并拒绝新 offer | accepted-design | 文档化设计；「没有任何出口」的部分是 R4-F2/R4-F7 的缺陷 |

测试覆盖缺口（夹具未跨真实 DLL、无断电/睡眠/多网卡实机、无 parser fuzz 等）不是本账条目，
见 [审查轮记录](reports/REVIEW_ROUNDS_2026-09-23.md) 的「未覆盖」一节；找到具体失败再作为新条目上报。
