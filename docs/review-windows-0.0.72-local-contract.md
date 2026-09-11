# Windows 0.0.72：未提交树修复与验收记录

> 第 1–14 节保留此前记录；DNS 测试安装包见第 14 节。客户“绿灯但无网”后的自动诊断改动与未实机验证边界见第 15 节。历史行号/缺口描述以当轮为准。

范围：`client/windows-connection-contract` 的工作树，非 HEAD 审查。本轮用户明确追加要求制作可转发 Windows 测试安装包，覆盖此前“不要打包”；仍不提交、不改版本、不发布正式更新。此前安装状态见第 13 节，本轮结果见第 14 节。

**结论：已有 Windows 实机连接计时与实际家宽业务证据，尚不能判定整个产品验收通过。物理网卡 IPv4/IPv6/DNS 抓包、断核心故障测试及国内代表性机器仍待验收；状态日志不能代替不泄漏证明。**

路径简写：
- `A/` = `apps/windows/app/src-tauri/src/`
- `C/` = `apps/windows/crates/tono-core/src/`
- `S/` = `apps/windows/service/src/core/`

## 1. Protection blockers

- **已修：重入连接清空保护承诺。** `begin_fresh_admit` 只清理出口可用性标记，不再清除用户已承诺的保护会话。切节点后失败继续封锁，不能退回首次连接 FullRelease。`C/connection.rs:277`。
- **已修：Service 在重连途中重启可能把会话当首次未验证连接释放。** 持久化区分用户会话 commitment 与当前 core admission；同一 owner 重入继承 commitment，启动清理据此决定是否可释放。覆盖连续两次 Service 重启。`S/windows_kill_switch.rs:58`、`:1116`、`:2484`、`:3003`。
- **已修：Protected Offline 对所有进程重开共享 API IP 物理出口。** Blocked 不再生成 API permit；已承诺会话即便重入 Bootstrap 也不提供 API 地址集。保留仅 core + 节点端点的恢复路径。代价：断隧道期间 API 不再借公共物理例外直连；首次、未承诺的 Bootstrap 例外仍存在。`S/wfp_model.rs:513`、`S/windows_kill_switch.rs:553`。
- **已修：DNS 把历史网卡数当活跃数、只读注册表的证据不足。** 状态使用当前活跃网卡数；原生读回 IPv4/IPv6 resolver 及 profile override。App 在所有活跃网卡 DNS 未证明时拒绝 Connected，再执行 system fake-ip；不再仅检查单网卡 warning。`S/dns/engine.rs:834`、`S/dns/mod.rs:2502`、`A/tono/connection/cleanup.rs:86`、`A/tono/connection/stages.rs:278`。
- **未实机验收：** IPv4/IPv6 断隧道抓包、Windows Home 多网卡/单网卡 DNS 原生行为、浏览器 DoH 与流量出口均为 **unverifiable here**。单元测试/交叉检查不是不泄漏证明。IPv6、UDP 和 fake-ip 门槛未放宽。相关保护路径同上。

## 2. Home chain

- **仅执行 `homeSocks5`。** `homeProxy` 仍可反序列化以明确拒绝并要求迁移，不再生成独立 VLESS 家宽组或家宽物理路由排除；混合旧、新字段同样拒绝，不猜优先级。`C/catalog.rs:153`、`C/config.rs:486`、`A/tono/connection/endpoints.rs:15`。
- **指定 AI：客户端 → 所选 VPS (`Tono-Exit`) → SOCKS5 (`Tono-Home-Residential`)。** 单成员家宽组，无 VPS fallback；TCP-only AI 规则，UDP 继续走拒绝底线。无家宽时不生成家宽跳点，普通海外仍走所选 VPS。没有添加家宽/三站 admit 探测。`C/config.rs:653`、`:664`、`:883`。
- **已修：下载状态冒充已应用。** UI 只读取已承认 runtime 的 `applied_routing`；commit 前核对捕获的家宽配置未被更新覆盖；目录同步和 monitor 均发现家宽变更并要求应用，不把凭据轮换当无变化。`A/tono/commands/mod.rs:285`、`A/tono/connection/stages.rs:322`、`A/tono/catalog_sync.rs:153`。
- **中国 DIRECT：保留机制、本版仍关闭。** 因而本版微信等并未启用物理 DIRECT；它不是家宽分流，也没有把全部网站改为家宽。`A/tono/connection/direct.rs:121`。
- **未实机验收：** 家宽正确/断网/错误凭据、节点切换后家宽第一跳跟随 selector、普通海外不走家宽，均为 **unverifiable here**。静态配置和测试证明无 fallback，不证明上游可用。`C/config.rs:653`。

## 3. Fast：同一保护路径

已删除的重复/非必要等待：

1. **WFP 精确集合枚举前逐条 GetByKey。** 精确集合相等已同时证明缺失数和多余数均为零；删除每条规则额外一次 BFE RPC，未删除 provider/sublayer 或精确集合证明。新增缺失 floor、残留 TUN/API permit 的集合回归。`S/wfp/mod.rs:811`、`S/wfp_model.rs:701`。
2. **空 WFP diff 的写事务。** 无增删时不开 BFE 写事务，仍进行精确读回。日志记录 expected/add/remove 数量，不输出地址或密钥。`S/wfp/mod.rs:790`、`:851`。
3. **DNS 整批重复写入。** 用当次双栈 native proof 跳过已正确的网卡，仅重写变更/未证明项；不以旧 success flag 代替读回。历史离线网卡失败不强迫所有活跃网卡重复 apply。`S/dns/engine.rs:744`、`:750`、`S/dns/mod.rs:1882`。
4. **Service 会话接管重复 get_version。** 一次结果同时得出 runtime staging 和 DIRECT reload 能力。`A/core/service/mod.rs:690`。
5. **redacted 诊断副本阻塞首次变绿。** 移到成功后的异步任务；未移动实际 runtime 写入、WFP、DNS 或 fake-ip。`A/tono/connection/stages.rs:367`。

如何量：`LocalStep` 记录 generation、静态步骤名、单步 elapsed_ms、完成/取消/超时；controller 与 WFP/TUN、DNS 与 fake-ip/lock verify 各自记录并行子项。`completed` 仅指 await 返回，不冒充嵌套操作成功；用 ConnectOk/ConnectFail 判结果。结合 Service WFP delta、DNS rewrite 数量，按 ConnectBegin 分隔冷连、热连、切节点和恢复。`A/tono/audit.rs:69`、`A/tono/connection/transaction.rs:93`、`A/tono/connection/stages.rs:256`。

**剩余本地工作（按结构性重复优先级，不冒充实测耗时排序）：**
- Service stop/start 两处仍有重叠的 Blocked 撤权入口；本轮削掉内部逐条查询及空事务，但没有借缓存跳过每次入口的 live proof。应结合新增计数确认剩余调用成本，只有同一生命周期、同一 core 撤权边界可合并，不能仅凭 DIRECT 关闭删屏障。`S/manager.rs:629`、`:736`、`S/windows_kill_switch.rs:900`。
- DNS 仍有 apply 前后及 status 的枚举/读回；native delta 已避免整批写入，是否值得共享同一次一致性快照需要实机 span。`S/dns/mod.rs:1882`、`:2502`。
- **首次变绿毫秒数、P50/P95 和是否仍需十几秒：unverifiable here。** 没有实测前不能宣称速度达标，也不能把十几秒视为验收完成。所有连接超时/WFP/DNS/fake-ip 门槛保留。`A/tono/connection/transaction.rs:30`。

## 4. Stable

- **短暂 Service IPC 失败不再停 core。** 撤销绿色声明、保留 WFP/core，持续观测；恢复需 system fake-ip 加新鲜 Service/core generation/Locked proof，不用 HTTPS 或计时器冒充保护证明。`A/tono/connection/monitor.rs:554`、`:703`。
- **WFP/DNS 异常先本地修复。** 同一 runtime 最多三次 session-gated 本地修复，失败留在受保护离线、继续观测，不陷入重复 StopClash/StartClash；detach 持有现有 release barrier，防止取消后的晚到写越过显式释放。`A/tono/connection/monitor.rs:694`、`:762`。
- **core 身份变化不被 NIC debounce 吞掉；CAS 合并不杀观察循环。** `A/tono/connection_health.rs:162`、`:248`。
- **关闭的 DIRECT overlay 更新不重建。** 实际家宽变更、core 身份变化等仍走受控重建，不把旧 runtime 当新策略已应用。`A/tono/policy_sync.rs:101`、`A/tono/connection/monitor.rs:897`。
- **仍需补齐：实际物理默认路由变化与普通通知尚未用 LUID/gateway 指纹单独分类。** 当前 NIC 通知只有 core/保护变化才触发恢复，活跃 DNS 漂移另行观察修复；不能把这说成已经完整处理了所有真实切网。`A/tono/connection/monitor.rs:735`。切网/休眠实机验收仍为 **unverifiable here**。

## 5. Nits 与检查

- 删除失效的时间 hold“证明”函数及关联死测试；更新 DNS 预算说明，不再写 PowerShell 是本版热路径。`A/tono/connection/monitor.rs:517`、`A/tono/connection/transaction.rs:9`。
- 诊断副本异步写仍沿用旧的单文件 best-effort 行为；代际检查后极慢的文件系统操作可能晚到，副本不宜作为当前 runtime 的权威证据。产品状态使用 `applied_routing`，不依赖副本。`A/tono/connection/stages.rs:367`、`A/tono/connection/platform.rs:258`。

验证结果：
- tono-core：226 单元 + 10 集成通过。
- Service：298 通过（standalone/test，包含模拟 WFP/DNS；不是实机包过滤测试）。
- App：446 通过（features clippy）。
- ConnectPill：9 通过。
- Service：x86_64-pc-windows-msvc 的 standalone lib check 通过。
- App Windows check：被 ring/aws-lc-sys 缺少 Windows C/SDK 头文件（assert.h）阻断，非通过。
- git diff --check 通过；版本/lockfile 无差异。没有打包或提交。

本轮证据不构成最终放行：需在同一工作树完成 Windows 冷/热连计时与断隧道、DNS/IPv6、家宽分流实测后一起判定。


## 6. 第二轮：继续削减本地重复，保核处理真实切网

本轮未打包、提交、改版本或改 DIRECT 开关。家宽仍仅按已应用 `homeSocks5` 走指定 AI 分流；未改变上一轮家宽合同。

### 6.1 同一保护路径更少等待

- **空停核消除。** Cold start 没有 PID/config/watchdog/failed-child 任一监督记录时，不再执行空 StopCore；任一记录存在仍真实停核。最终 orphan sweep、core 安全身份撤销和 WFP 屏障保留。`S/manager.rs:402`、`:737`、`S/server/mod.rs:164`。
- **重复 Blocked 不再重复 install。** 只对已记录为 Blocked、无 TUN/DIRECT 且目标 filter 集合不变的请求，做当次内核精确 readback；成功就不 reinstall，读回失败或漂移立即 fallback install。不是缓存/TTL 复用。回归证明重复调用为 0 install + 1 verify，模拟漂移后必须增加 1 install；既有直接放行状态的第一次撤权仍安装 Blocked。`S/windows_kill_switch.rs:1540`、`:3121`。
- **DNS 合并返回状态的重复读回。** 当前操作已完成的原生 proof 直接生成 reply，不再为组装状态重读恢复文件和所有网卡。Apply 后保留一次新的双栈原生检查；缺 snapshot、零活跃网卡、native proof 失败仍不允许 enabled。`S/dns/mod.rs:1871`、`:1890`。
- **DNS 恢复文件只写变化。** 初次 originals 必须先持久化；成功 apply 没改变记录时不再第二次 fsync。新网卡、失败标志变化和失败恢复仍写入；从本次成功读取/写入比较，不使用跨请求旧缓存。`S/dns/mod.rs:1864`、`:1885`、`:1910`。
- **首连不等 API 域名新 DNS。** 使用编译内置 + Service 已验证保存的 public IPv4 pins；Service pin adoption 与其他 preparation 并行，新地址仍由原有 Connected 后任务经 TUN 学习。未绕过 WFP、系统 DNS apply 或 system fake-ip；未降低其 timeout。`A/tono/connection/stages.rs:128`、`A/tono/connection/monitor.rs:1007`。
- **监控两个独立只读 IPC 并行。** Service snapshot 与 DNS status 不再串行等待；Service 失联仍只计 Service leg，不能拿另一个结果冲掉未观测故障。`A/tono/connection/monitor.rs:541`。

**剩余耗时怎么排：** 仍需按 `LocalStep` 的实际关键路径统计 Service preparation/start、WFP/TUN ready、native DNS apply/readback 和 system fake-ip，分别给冷/热连 P50/P95。并行子项不能简单相加；目前没有 Windows wall-clock 数据，不能伪造耗时排名或声称已低于十几秒。下一处是否合并必须由这些 span 指向重复操作，而不是删证明或减 timeout。`A/tono/audit.rs:69`、`A/tono/connection/transaction.rs:93`、`A/tono/connection/stages.rs:256`。

### 6.2 更稳，不靠反复重启 core

- **新增物理出口指纹。** 使用活跃硬件接口的 LUID/gateway/source；route metric + interface metric 选择候选。WinTUN、虚拟接口、禁用默认路由的接口不作为候选；等价度量的枚举重排保留当前可用候选。两个不同 tick 确认变化，pending 不会被 debounce 吞掉；网卡无路由后恢复即使同一指纹也会协调一次。`A/tono/connection/physical_route.rs:46`、`:134`。
- **原生读取失败不虚构切网。** 保留已有证据；读取最多等待 2 秒且 worker 持有单飞 claim 到真实返回，避免挂住整个 health loop 或反复创建卡死线程。这是新增后台观察的上限，不是削减连接保护超时。`A/tono/connection/physical_route.rs:108`。
- **真实切网只做本地协调。** 保留已配置 auto-route/auto-detect-interface 的 core/TUN，协调 DNS，过 system fake-ip 和新鲜 same-core/Locked proof 后清除 pending；不重启核心，不添加第三方考试。健康时无需为一次物理切网让按钮跳离 Connected；证明失败仍转受保护离线。`A/tono/connection/monitor.rs:723`。
- **DNS-only 修复不重装健康 WFP。** 先证明同一 owner/core 的 Locked 状态；只有 WFP leg 不健康才执行 lock。`A/tono/connection/monitor.rs:841`。
- **移除修复三次后的永久死路。** 采用 2/5/10/30 秒、之后 30 秒的重试间隔；后台仍每 2 秒观测，成功重置，不永久放弃、更不循环 StopClash。旧 hard DNS error 也不能压过显式 enable 的新鲜完整 native proof，避免“其实已好、仍永远离线”。`A/tono/connection/physical_route.rs:269`、`S/dns/mod.rs:1868`。

原生 API 入参按微软文档核对：接口读取指定 Family + LUID，路由查询指定接口并读取最佳源地址。[GetIpInterfaceEntry](https://learn.microsoft.com/en-us/windows/win32/api/netioapi/nf-netioapi-getipinterfaceentry)、[GetBestRoute2](https://learn.microsoft.com/en-us/windows/win32/api/netioapi/nf-netioapi-getbestroute2)。文档核对和类型检查不代替 Windows 切网实测。

### 6.3 Nits

- 修正 DNS“readback 不作门槛”“不会漏”“继续 fake-ip 即可”的过时说明与诊断；回归要求明确 native DNS、fake-ip、WFP 是独立必需证据。更新 native 调用预算、DIRECT 已关闭及保核恢复说明，不改变超时与开关。`S/dns/mod.rs:32`、`:748`、`:1195`、`S/dns/tests.rs:957`、`A/tono/connection/direct.rs:116`、`A/tono/connection/monitor.rs:862`。

### 6.4 最新证据与仍未验收项

- App：453 tests 通过。
- Service：303 tests 通过。
- tono-core：226 单元 + 10 集成通过；ConnectPill：9 tests 通过（均重新运行）。
- 新增原生路由模块：直接引用工作树源文件的最小 harness，`x86_64-pc-windows-msvc --tests` check 通过，不是 Windows API 运行测试。
- Service：`x86_64-pc-windows-msvc --features standalone --lib` check 通过。
- 整个 App 的 Windows check 仍受本机 Windows C/SDK 头文件缺失阻断；不能把模块检查冒充整个 App 通过。
- `git diff --check` 通过；产品 manifests、lockfiles、版本文件无变化。

**仍不能放行的证据缺口：** Windows 真机冷/热连 P50/P95、物理路由变化后的真实转发（含双网卡/等价路由）、断 core 时物理 IPv4/IPv6/DNS 抓包、真实家宽链式出口均为 **unverifiable here**。本轮证明的是删掉了哪些重复操作及保留哪些保护检查，没有虚构秒数。保护完整但连接仍十几秒，依然不算验收完成。


## 7. 第三轮：落实用户确认的 1–5

范围仍为未提交的 Windows 0.0.72 工作树。本轮没有打包、提交、部署、改产品版本、改协议 epoch/revision、改 DIRECT 开关或改家宽分流合同。

### 7.1 已落实

1. **旧核心占用 DNS 端口不再白等。** `admit_dns_listener` 协调两个只读结果：端口可用即通过可用性检查；当前 owner 的完整受保护 runtime 证明到达即可结束端口重试。身份不明且端口冲突仍失败。取消的只是只读预检，不是后续 native DNS 或 fake-ip。原先旧核心一直占用端口时的 29 × 100 ms 等待已不再必经；不把这个代码推导量冒充整机提速。`A/tono/connection/controller.rs:408`、`A/tono/connection/stages.rs:139`。

2. **TUN 就绪由通知唤醒，保留兜底预算。** 新 Service 在一次 lock IPC 内等待；现有 IP Helper 回调直接发 readiness hint，独立于面向产品状态的 debounce/DNS 自写抑制。先注册 waiter 再查 TUN，避免漏唤醒；事件不消耗/重置原有 49 × 200 ms 兜底等待，持续通知也不能无限延长等待。每次尝试重新取得 lifecycle 锁并核验 owner/session；等待期间不持有 lifecycle/WFP 写锁。只有缺少 TUN/非 tunnel 的原生错误可重试，其余立即返回；App 不再对新 Service 的“已耗尽等待”再套 50 次 IPC。`S/readiness.rs:19`、`S/netmon.rs:138`、`S/server/handlers.rs:69`、`A/tono/connection/failure.rs:79`。

3. **切节点按最多 4 条并发关闭旧出口连接。** 仍先按 controller chains 筛选旧出口、只 DELETE 指定连接 ID；每批重新核验 App generation，取消后不继续排下一批。不使用全局断连接、不停 core，不改 WFP old∪new → new 的次序，也不缩短原有每请求超时。`A/tono/connection/switch.rs:298`、`:349`。

4. **最终绿灯改用新鲜 WFP 验证/提交回执。** fake-ip 前捕获当前 owner session/core PID+generation；native DNS 与身份读取并行，之后 system fake-ip，再请求 Service 提交。Service 在 owner lifecycle + WFP 操作锁内验证当前 Core/TUN LUID，持久化“保持保护”的承诺后，做当次精确 filter-set readback，再检查 Core/LUID/租约，才发回绑定 session/core 的回执。磁盘写入在最终精确读回之前，避免 fsync 让回执变旧；重复提交仍重新读内核，但不重复写同一 intent。发现漂移立即尝试精确 Blocked，不能发绿色回执。`A/tono/connection/stages.rs:260`、`:277`、`S/windows_kill_switch.rs:1165`、`:1173`。

   - 丢响应只允许重试新鲜证明，不能拿一般 `/kill-switch/status` 缓存恢复绿色。进入最终可能提交的 IPC 前，App 保守保留保护承诺；已发出的提交在 detached mutation guard 下收尾，避免取消/超时误排 FullRelease。明确 Disconnect 仍正常拥有释放权。代际取消后不再发第二、第三次旧提交，也不等退避计时器，避免让释放排在多个废弃 IPC 预算之后。Connected 仍必须等有效回执。`A/core/service/mod.rs:947`、`A/tono/connection/cleanup.rs:105`。
   - 新增可选 capability 和 opt-in payload，不改版本号。旧客户端的 null 请求和空回复保留；新客户端在连接前拒绝不支持 fresh proof 的旧 Service，明确要求修复，不能默默退回旧证明。`S/structure.rs:40`、`S/server/handlers.rs:278`、`A/core/service/mod.rs:548`。

5. **同轮恢复证明一次、消费一次。** WFP/DNS/切网/Service 恢复统一由本地修复返回完整证明；native DNS enable 的当次读回 → 一次 system fake-ip → 一次新鲜 Service WFP 回执。`/dns/status` 只是观察缓存，因此即使 IPC 恢复时缓存显示健康，也必须拿新的 native proof。通过后同轮恢复状态，不再等下个 monitor tick，也不再另跑一次 fake-ip。消费时检查 App generation、session/core、全部保护位和已应用家宽配置；不跨轮复用，不改成核心重启。`A/tono/connection/monitor.rs:812`、`:876`。

### 7.2 保护与家宽

- native DNS、system fake-ip、精确 WFP 和 TUN permit 都仍在 Connected 之前。IPv6/UDP/物理网卡权限未放宽。最终提交结果不确定时保守留在保护中，不显示 Connected；提交前的其它失败继续走原有失败路径。`A/tono/connection/stages.rs:260`、`A/tono/connection/cleanup.rs:105`。
- 家宽运行配置未改：指定 AI → 所选 VPS → homeSocks5；无家宽走 VPS，坏家宽不静默回退；中国 DIRECT 仍关闭。`C/config.rs:653`、`A/tono/connection/direct.rs:119`。
- 三站 HTTPS 仍不在 admission、monitor、switch 或主按钮控制路径；没有加入新的家宽 admit 探测。`A/tono/connection.rs:1294`。

### 7.3 回归与实机证据边界

- App：459 tests（含端口竞速、并发上限/代际终止、回执所有保护位、取消不再重试、同轮恢复路径约束）。
- Service：310 tests（含通知丢失/风暴/兜底、旧协议字段兼容、重复提交必须新鲜 readback、漂移 Blocked、Core generation 与同 PID TUN 重建拒绝）。
- tono-core：226 单元 + 10 集成通过；ConnectPill：9 通过。
- Service `x86_64-pc-windows-msvc --features standalone --lib` check 通过。App 完整 Windows check 仍受本机 Windows C/SDK 头文件缺失限制，不能冒充通过。
- `git diff --check` 通过；产品 manifests、lockfiles、版本文件没有变更。超时配置未缩短；只同步了单轮参考预算说明/测试，明确并行步骤不能相加当实际连接时间。

**Windows 冷/热连 P50/P95、切节点/切网转发、断核心 IPv4/IPv6/DNS 抓包、真实家宽链式出口仍为 unverifiable here。** 本轮交付的是同一完整保护路径上的具体去重与代际保护，不是“已达到 Proton 速度”的声明。保护和速度仍须在同一次实机验收同时通过。


## 8. 用户新增“再快 50%”目标：下一轮候选，尚未实现/验收

目标按 **第 7 节完成后的同机点击 → 真正 protectionReady 耗时减少 50%** 理解；不是下载吞吐，也不是 IPC 数量减半就算达标。冷连/热连/切节点分开比较 P50/P95，不能混合平均掩盖某条慢路径。当前没有这棵新树的 Windows runtime 基线，因此不能宣称能达到或已达到该幅度。

1. **优先查 IPC 的重复握手。** 每个 protected call 都新建 client，先发 Magic 再发业务请求。Windows 注册了 server PID verifier 时，vendor 为安全明确禁用池，两次请求各自重连并核验 Service。因此可研究“业务请求直接走原有强身份核验，省掉前置 Magic”，而不是打开当前未做身份核验的连接池。健康路径可将这部分 HTTP 请求由 2 减为 1；端到端耗时收益仍需实测。`apps/windows/service/src/client/mod.rs:244`、`:317`、`:370`、`apps/windows/vendor/kode-bridge/src/ipc_http_client.rs:193`、`:238`。实际管道对端 PID 的 API 语义参见 [GetNamedPipeServerProcessId](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeserverprocessid)；PID 仍须匹配 SCM 登记的受信 Service 身份，不能只检查它“存在”。

2. **WFP 尚有基础对象的重复管理事务。** `install` 每次先以事务尝试 Add provider/subLayer（已存在也走该路径），`verify` 在 `verify_by_key` 之前又查一次 provider。可删除后者重复查询；前者改为当次证实 provider/subLayer 完整时不打开管理写事务，缺项/异常进入原有修复并保留最终精确读回。不能靠进程内“曾经装过”的 bool 缓存，不改 filter permit。`S/wfp/mod.rs:203`、`:846`、`:896`。

3. **热恢复的更大收益候选：接管已保护的同配置 Core/TUN。** 当前已证明旧 runtime 受保护仍由 StartOwnerTransition 停旧核、materialize、启动新核。可考虑专门的严格接管分支：同 owner/session/二进制身份、应用配置（含 homeSocks5）、所选 selector 和 Core/TUN 均匹配时保留现有 core，重新做 native DNS/fake-ip/新鲜 WFP 证明。凭据/配置不匹配仍走原有受控应用；不能盲信 PID、旧绿色或下载配置，也不能影响显式 Disconnect。此项涉及更强的 runtime-applied 证明，风险高于前两项；不是默认直接复用旧隧道，更不是全连接系统重写。`S/server/mod.rs:163`、`:176`、`A/tono/connection/reconnect.rs:22`。

避免把 200 ms 轮询尾巴当全部瓶颈；按 Service/native 子 span 拆分排队、身份核验、BFE 管理事务、进程扫描、配置持久化和实际 TUN 就绪。仍不能删除最后一次安全进程检查或核心完整性验证来凑数字。验证必须包含选择节点/家宽应用一致、伪造 pipe 对端拒绝、Service 重启重验、core/LUID 变化拒绝以及物理 IPv4/IPv6/DNS 断隧道抓包。50% 与保护准确性须同时通过。


## 9. 第四轮：继续去重，同时尝试 ROG 无提权验证

### 9.1 Protection blockers

- **补上新发现的原生证明缺口。** 旧 provider 没有绑定 Service，且旧验证只核对过滤器键，可能把 BFE 返回的 disabled 过滤器当作正常保护。现在创建时绑定产品现有的自动启动 Service；每次读取 provider 的持久性、disabled 位、Service 绑定，以及 sublayer 的 provider/权重/持久性。最终证明还拒绝 disabled 或错误 sublayer 的过滤器。此风险来自代码与 Windows API 语义，不是声称已经在 ROG 抓到泄漏。`S/wfp/mod.rs:219`、`:313`、`:935`；[Microsoft：过滤器 disabled 与 Service 绑定](https://learn.microsoft.com/en-us/windows/win32/api/fwpmtypes/ns-fwpmtypes-fwpm_filter0)。
- **旧 metadata 迁移不能提交空规则窗口。** provider/sublayer 重建、旧 Tono 对象清理和完整目标规则安装同处一笔写事务；失败走原有 abort。禁用/错 sublayer 的同键过滤器在该事务内删除重建，不能用 Add(ALREADY_EXISTS) 冒充修复。不调用 emergency_disarm，不删除其它 provider 对象。`S/wfp/mod.rs:291`、`:896`；`S/wfp_model.rs:791`。真实 BFE 迁移成功、回滚与重启抓包尚未实测。
- **最后读回用一致的原生快照。** provider/sublayer 读取、枚举器创建和全部枚举页放入同一只读事务，仍要求精确集合、无缺项/额外旧 permit。不是复用曾经安装成功的 bool。`S/wfp/mod.rs:935`；[Microsoft：枚举器快照与显式事务](https://learn.microsoft.com/en-us/windows/win32/api/fwpmu/nf-fwpmu-fwpmfiltercreateenumhandle0)。
- DNS native 双栈读回、system fake-ip、最终 Service 新鲜回执仍在绿色之前；IPv6/物理网卡例外未放宽。`A/tono/connection/stages.rs:267`、`:278`。

### 9.2 Home chain

本轮未改家宽合同或应用配置：指定 AI → 所选 VPS → homeSocks5；未配置走 VPS，配置坏了不静默当未配置；仍 TCP-only、非全站家宽。`C/config.rs:653`、`:664`。下载配置不等于 applied 的现有核验保留。中国 DIRECT 仍关闭，未借此提速。`A/tono/connection/direct.rs:119`。真实家宽出口仍未验证。

### 9.3 Fast：删除什么，如何量

1. **Windows 业务 IPC 从 Magic + 业务请求改成只有业务请求。** 保留实际管道的 PID/SCM verifier，vendor 仍禁用未经验证的池；owner/session envelope 和协议头不变。纯 liveness `connect()` 仍必须实际发送 Magic；Unix 行为保留。写请求仍最多一次自动尝试，丢响应不自动重放。`apps/windows/service/src/client/mod.rs:234`、`:304`、`:321`。
   - 健康的一次业务调用，这一部分请求数 2 → 1；不等于点击到绿色快 50%。连接/生命周期预算未缩短；GetVersion 显式使用既有 STATUS_TIMEOUT，不再落入 50/150 ms 交互默认值。`apps/windows/service/src/client/mod.rs:404`。
2. **健康 WFP foundation 不再重复 Add provider/subLayer 写事务。** 当次原生读取完整且规则 diff 为空时，零管理/规则写事务；缺对象时把基础对象创建与规则安装合到一笔写事务；旧无绑定对象需要一次完整原子迁移。`S/wfp/mod.rs:219`、`:896`、`:967`。
   - 删除 `verify()` 额外一次 provider 查询；必要的最终一致只读事务保留。因此不是承诺所有 BFE RPC 数量下降，而是移除重复写锁与管理写入，不削弱证明。`S/wfp/mod.rs:1038`。
3. **生产 INFO 级可见的脱敏本地计时。** `engine_open`、`foundation_read`、`filter_enumeration`、`app_id`、`policy_write`、`exact_readback` 记录 elapsed_us/成功位；另记 foundation plan 和增删数量，不记端点、配置或凭据。`S/wfp/mod.rs:953`、`:967`。与 App LocalStep/ConnectOk 对齐，在同机分别采冷连、热连、切节点 P50/P95；事务迁移的首次成本单列，不能混进热连平均。

**仍没有第 7 节完成后的 Windows runtime 基线，也没有本轮同机对照。50% 目标未验收，不能用单测耗时或 IPC 数量代替。** 保留健康旧 Core/TUN 的严格接管候选未在无实机证明时冒进实施；当前先把本轮实际链路的本地耗时量出来。

### 9.4 Stable

本轮没有改恢复状态机、stop_core 条件或 generation/single-flight。旧核心身份未变的本地修复仍是 native DNS → 一次 fake-ip → 新鲜 WFP 回执，同轮消费；没有恢复到三站 HTTPS 控制状态。`A/tono/connection/monitor.rs:812`、`:880`。WFP metadata 修复在 Service 原子事务内完成，不要求为了基础对象重建去停核心；真实转发稳定性仍待 Windows 验证。

### 9.5 Nits、检查和 ROG 边界

- 修正 IPC 注释中“vendor 仍在 async worker 内同步打开管道”的过时描述；当前 native open 已是有界、可等待的独立工作。没有借清理注释调整超时/重试。
- 原生 WFP qualification 测试现在必须显式设置既有 `TONO_REQUIRE_REAL_WFP=1` 才能触碰真实引擎，避免普通单测因终端恰好有权限而写物理防火墙；现有 CI qualification 已设置该值。更新测试对旧 ensure helper 的调用，保留真实测试入口。`S/wfp/real_engine_tests.rs:7`、`:63`。普通安全测试跳过它不算原生资格通过。
- App：459 tests 通过。Service：325 tests 通过（本轮使用 `standalone,client,test`，包含 IPC 和规则模型检查）。Windows x64 **生产库** `standalone,client --lib` check 通过。原生库测试编译探查修复了一个旧 helper 引用；无 `test` feature 的全 integration-target check 受既有 test-only helpers 限制，不能把该命令算通过。原生资格应按现有 CI 的 `--lib` 方式在 Windows 上执行；这里未执行。
- `git diff --check` 通过；manifests、版本、lockfiles 无变更。未打包、提交、安装、部署或修改运行中 Service。
- **ROG：Orca 保存了名为 rog 的环境，但远端 status/worktree 查询均返回 runtime_timeout；额外一次有界 status 重试也未得到响应。** 没有建立 Windows 执行会话，因此没有 Windows shell、权限检查、源树同步、现场计时或抓包结果；未触发 UAC，未操作远端网络。当前阻塞是远端 runtime 不响应，不是“用户尚未点管理员”。

结论：本轮代码修复与离线回归完成；整机“正确保护且再快 50%”验收尚未通过。ROG 可达后先做无提权的版本/源树/工具链核对和安全测试；新 Service 的实际安装、故障注入及抓包不能在当前无人批准提权的条件下假装完成。


## 10. 第五轮：客户连接失败，先保留事实，再做窄范围本地修复

范围为本轮开工说明中的前三项：清理前现场、本地选路诊断、首次 fake-ip 阶段的一次 DNS 修复。没有部署客户机器；没有实现额外 build 指纹或改变退出时的 Service 生命周期。客户的 `dns-latch` / 三站失败报告仍属于旧运行流程，不能冒充当前未提交树的运行基线。

### 10.1 Protection blockers

- **清理前冻结的是“已观测事实”，不是把清理后 inactive 推断成从未保护。** 每次尝试记录带时间/来源的 Core PID、Service/Core generation、WFP 保护位、native DNS 回复，以及异步路由观测；失败分支立即冻结，超时也在退休代际之前完成，避免晚到 DNS 补偿先改写现场。未获得的字段明确为 `not observed`。原有失败 WFP 读取单独标记为稍后观测（可能已发生异步清理），不覆盖冻结值，也不增加 RPC。`A/tono/connection_evidence.rs:148`、`A/tono/connection.rs:432`、`A/tono/connection/cleanup.rs:95`。
- **诊断不参与保护放行。** native DNS 成功 → system fake-ip 成功 → 同 Core 的新鲜 Service WFP/TUN 回执 → Connected 顺序保留。可选修复既不能代替 fake-ip，也不能拿缓存 Locked 或选路表当真实内核保护证明；已知 Core/session 变更不被接管。`A/tono/connection/stages.rs:277`、`:293`、`:297`、`:334`；`A/tono/connection/admission_repair.rs:17`。
- **IPv4/IPv6/DNS 的实机无泄漏仍为 unverifiable here。** 本轮不改 WFP 规则或 IPv6/UDP/物理网卡许可，不改原有首次失败与已承诺会话的释放区别。诊断中的 `serviceReported` 是最后一次 Service 观测，不是抓包证明，也不代表读取时刻与失败时刻完全相同。

### 10.2 Home chain

- 家宽合同不变：指定 AI → 所选 VPS → `homeSocks5`；无配置不发明跳点，坏配置不回退 VPS，普通海外不改成全站家宽。`C/config.rs:653`、`:664`、`:862`、`:882`。
- 新修复先检查捕获的家宽配置仍与当前一致，最终 Connected 前仍检查 applied 配置。选路诊断只接收所选 VPS 地址，不对家宽发起物理连接，也不输出任何目标地址/凭据。中国 DIRECT 仍关闭。`A/tono/connection/admission_repair.rs:93`、`A/tono/connection/stages.rs:258`、`:326`、`A/tono/connection/direct.rs:119`。真实家宽链式出口仍为 unverifiable here。

### 10.3 Fast：不加新健康路径等待，不把修复次数当提速数字

1. **选路观测在旁路异步执行。** 使用本地 `GetBestRoute2` 分别读取 fake-ip 范围的一个代表样本、所选 VPS 的实际选路；不约束接口以免“证明自己的输入”。只输出 Tono TUN/物理/其它虚拟/未知分类、LUID 与原生错误码；不发 HTTP/TCP/外部 DNS 探测，不作为连接或掉线门槛。代表样本不证明全部目的地。`A/tono/route_diagnostics.rs:110`、`A/tono/connection/stages.rs:255`。
   - 不阻塞变绿；原生工作单飞、观察等待上限 2 s。即使等待超时，未退出的原生 worker 仍持有单飞，避免不断堆新工作；超时仅记 unknown。`A/tono/route_diagnostics.rs:86`。
2. **健康首次 fake-ip 命中不增加修复 RPC。** 原有三次查询、每次预算和间隔保留。仅非 fake-ip 答案、无 A 记录或本地封装已确认取消完成的 DNS 超时允许插入一次修复；未知、权限/认证错误或取消未完成不授权重写。修复后使用剩余查询次数，不重开三次，也不重置总连接时钟。`A/tono/connection/probes.rs:199`、`:209`、`:271`。
3. **失败路径争取省掉整套重连，而非砍超时。** 同 Core 的这次修复只调用既有、带 native 双栈读回的 DNS enable；已有正确配置仍走 Service 的实时读回/差量路径，不强制全网卡重写或重启。DNS 刷新若失败仍不能绿。此分支可能增加一次状态读取及 DNS 调用成本，不能宣称所有失败都会更快。`A/tono/connection/admission_repair.rs:42`、`:103`；`S/dns/mod.rs:1864`。
   - `admission repair Core identity` 与 `admission native DNS refresh` 分开记录静态步骤名、耗时、结果；原有 `system fake-ip` 与 WFP/native span 保留。对比“同 Core 修复成功”与“退回完整尝试”的耗时和频次，同时单列健康冷/热连 P50/P95。`A/tono/connection/admission_repair.rs:71`、`:106`。

**剩余主瓶颈仍需量 Service / WFP / TUN / DNS，而不是三站。** 客户旧报告的 10.0 s 启动与 3.8 s 锁定不能进一步分摊成 BFE、磁盘或 TUN 的真实成本。上一轮 IPC/WFP 去重见 §9；本轮没有 Windows 同机基线，不宣称已再快 50%，也不接受“完整保护但仍十几秒”作为产品完成。

### 10.4 Stable

- **首次 DNS 传播类故障先原地修一次，不 stop/start Core。** 复用现有 recovery 单飞；其它恢复正在进行、只读 Service 信息不可用或保护观测不确定时，跳过可选刷新并保留原有剩余查询，不新增误失败门槛。已知 owner/Core 身份或家宽配置变化则拒绝继续。`A/tono/connection/admission_repair.rs:17`、`:42`。
- **取消只结束等待，不遗弃原生 DNS 写入。** 子任务持有 recovery 单飞至既有 cancellation-safe DNS 变更/补偿结束，仍使用原始 transaction 的 deadline/cancellation；晚到结果按原有代际与 release 意图对账。没有另起完整连接时钟，也没有围住原生变更再套一个会提前释放单飞的 timeout。`A/tono/connection/admission_repair.rs:60`、`:98`、`A/tono/connection/cleanup.rs:76`。
- **修正旧失败在 dispatch/状态读取期间被切换后的归属。** `Attempt::Failed` 携带失败所有者的 generation；超时只有在原代际仍归自己时才原子退休并接过清理归属。失败处理在读取 WFP 前后检查该归属，失效则不覆盖新现场、不启动旧失败清理或调度。主连接、重连、切节点、监控重入均传递该标识。`A/tono/connection.rs:172`、`:333`、`:432`；`A/tono/connection/cleanup.rs:17`。
- 冻结后的 DNS/选路晚到结果不能改写历史，新尝试清空旧尝试记录。三站 HTTPS 继续不在 admission/monitor/switch/主按钮控制路径。`A/tono/connection_evidence.rs:66`、`:148`；`A/tono/connection.rs:264`。

### 10.5 Nits、回归和边界

- 新证据只在组装诊断时附加到既有 `error` 字段，不污染 FSM 的错误/重试分类；保留既有 schema、上传白名单、二次脱敏和文本长度限制。只记录类型化状态，不带端点、配置、密码、token 或原生错误自由文本。上传仍由用户发起；本轮没有扩大上传字段。`A/tono/diagnostics.rs:278`、`A/tono/connection_evidence.rs:188`。
- 修正“阻断时诊断总能借物理 API 出口上传”和“三站数据面证明用于连接步骤”的旧注释。复制诊断仍是本地操作，上传失败不为此重开物理例外。`A/tono/diagnostics.rs:5`、`A/tono/connection/probes.rs:1`。
- **App：479 tests 通过；Service：325 tests 通过；ConnectPill：9 tests 通过。** 新增覆盖清理后状态与清理前证据并存、脱敏/白名单/文本上限、单飞/代际与冻结、可选修复一次/原剩余次数、健康零修复、未知不变更、取消与总截止时间、最终 fake-ip/WFP 顺序。
- **Windows 原生路由模块交叉 check 通过。** 外部最小 harness 直接引用实际路由源文件，目标 `x86_64-pc-windows-msvc`；不是完整 App Windows build，更不是 Windows 执行。完整 App Windows 检查仍受本机缺少 Windows SDK C 头文件限制。真实 WFP/DNS、选择 VPS 与家宽转发、冷/热连和断隧道抓包均为 unverifiable here。
- `git diff --check` 通过；产品 manifests、锁文件、版本号均无改动。无打包、提交、安装、部署、运行中 Service 变更或 UAC。ROG 可用执行会话仍未建立，沿用 §9 的远端 runtime 不响应边界，本轮没有假装远程验证。

本轮三项修复已完成代码与本地回归；客户旧安装包不会自动获得这些变更。产品最终验收仍要求同一 Windows 运行同时满足保护完整、正确选路和连接速度目标。


## 11. 第六轮：定位完整启动成本，区分同版本构建，核查热接管边界

对应本轮计划：①补 Service 启动分项计时；②核查严格热接管；③补构建指纹与错误分类。①③已实现，②完成源码可行性核查但**没有开启复用运行实例的快路径**：当前证明缺口不能用旧绿灯、PID 或构建指纹填补。本轮没有删除任何安全检查，也没有实际 Windows 提速数据。

### 11.1 Protection blockers

- **计时只是旁观，不加放行分支。** 保留认证、SCM/pipe 身份、owner/session 生命周期锁、最终进程清场、核心镜像完整性、WFP 撤权/安装、TUN 等待、原生 DNS 和最终 App fake-ip/新鲜 WFP 回执。计时没有自己的超时、重试、spawn 或安装操作。`S/local_timing.rs:71`、`:99`；`S/server/handlers.rs:69`、`:536`；`S/manager.rs:613`；`S/runtime_generation/assets.rs:254`。
- **计时结果不冒充保护证明。** HTTP/队列返回记 `returned`，中断记 `interrupted`；原生 DNS 即使返回 `Ok(status)`，保护位不足仍记 `unproven`，不把正常返回当 DNS 已安全。输出结果原样交回原来的业务判断。`S/local_timing.rs:80`、`:99`；`S/server/handlers.rs:424`。
- **构建指纹不能授权。** 新字段仅用于诊断，未接入 admission、监控恢复或复用判断；缺失也不改协议兼容判断。App/service 版本号与协议 revision 不变，原有 `fresh_protection_proof` 能力门槛仍独立存在。`apps/windows/service/src/lib.rs:6`；`S/structure.rs:40`、`:1202`；`A/tono/diagnostic_contract.rs:142`。
- IPv4/IPv6/DNS 断隧道抓包仍为 **unverifiable here**。本轮不改 WFP filter 权限、DIRECT 或 DNS 引擎行为，不能据此宣布实机无泄漏通过。

### 11.2 Home chain

指定 AI → 所选 VPS → `homeSocks5`、无配置走 VPS、坏配置不静默回退、TCP-only 与非全站家宽不变。中国 DIRECT 仍关闭。新指纹只读构建时明确列出的 Rust 源文件和固定 Cargo 构建属性，不读运行配置、用户配置、节点数据或家宽凭据；日志不新增端点/密码内容。`C/config.rs:653`、`:664`；`A/tono/connection/direct.rs:119`；`apps/windows/build_support/connection_fingerprint.rs:35`。

### 11.3 Fast：把 10 秒拆开，不能继续猜

四个入口 `PrepareCoreStart`、`StartClash`、`LockKillSwitch`、`EnableProtectedDns` 现在各有请求级 trace id，所有子项带相同 id、静态步骤名、微秒耗时、结果及 Service 构建来源标识。普通未进入这些 trace 的调用不新增计时日志。`S/server/handlers.rs:69`、`:406`、`:492`、`:536`；`S/local_timing.rs:42`。

可区分的关键成本：

| 成本 | 计时项 / 代码 |
| --- | --- |
| 认证与等待生命周期锁 | `request.authenticate_owner`、`request.owner_lifecycle_queue`；`S/server/mod.rs:751`、`:784` |
| 初始清场与最终启动清场 | `prepare.startup_reconcile`、`prepare.orphan_process_sweep`、`core.final_prepare`；`S/manager.rs:573`、`:613` |
| 核心镜像验证、owner 安全状态和配置规划 | `runtime.validate_core_image`、`runtime.secure_owner_state`、`runtime.plan_refresh`；`S/runtime_generation/assets.rs:254` |
| WFP Bootstrap | `start.wfp_bootstrap`；`S/server/handlers.rs:600`，内层继续使用 §9 的 BFE 分项日志 |
| 停旧核心及持久化退休状态 | `transition.retire_previous`、`retire.stop_core`、`retire.persist_stopped`；`S/server/mod.rs:131`、`:165` |
| 运行配置落盘、启动、IPC 安全、运行记录和 owner commit | `start.materialize_runtime`、`core.spawn`、`core.secure_ipc`、`core.persist_runtime_record`、`commit.persist_active_session`；`S/server/mod.rs:190`；`S/manager.rs:655`、`:706` |
| TUN/锁定与 DNS | `lock.owner_lifecycle_queue`、`lock.native_attempt`、`lock.tun_readiness_window`、`dns.apply_and_native_readback`；`S/server/handlers.rs:84`、`:424` |

**如何用：** 先在当前树对应的 Windows 构建上采冷连、热连、切节点分别的 P50/P95 和失败率；请求内只比较同层子项，不能把 parent+child 或并行 App 步骤相加。TUN 等待总窗包含各次尝试；每次尝试包含原生工作，不能重复归因。Service trace id 不是 App generation，跨 RPC 用入口顺序和时间对齐，不假装已经有跨进程完整链路 id。Service trace 从进入处理器开始，不包含 App 侧打开管道、SCM 验证和序列化；与 App LocalStep 的差额不能直接算给 WFP。

**本轮没有删掉这两处“看起来重复”的工作：** DNS preflight 前清场和真正 spawn 前清场之间存在进程表竞态；磁盘运行文件相同也不等于内存中已经应用同一配置。新增计时将检验它们是否真占大头，不能仅凭重复调用就删除最终安全门槛。`S/manager.rs:605`；`S/runtime_generation/staging.rs:237`。

这轮是定位后续大块优化的基础，不是已减少 50% 耗时的证明。没有声称计时日志零成本，也没有把测试运行耗时当连接速度。保护完整但仍十几秒，依然不算产品完成。

### 11.4 Stable：严格热接管的核查结论

当前信息足以“保留旧核心等待受控替换”，不足以“接管旧核心并显示 Connected”：

1. `running_core_config` 返回 Core 身份与 `ClashConfig`，后者主要描述路径和日志配置；没有与该 Core generation 绑定的实际已应用节点/家宽配置回执。`S/manager.rs:553`；`S/structure.rs:633`。
2. 现有 `is_protected_startup_replacement_candidate` 只用于 DNS 端口例外和替换前保留核心，未证明所选节点/家宽与本次请求一致。`S/structure.rs:765`；`A/tono/connection/reconnect.rs:22`。
3. Mihomo selector 可通过控制器改变，所以仅比较磁盘 YAML、配置路径或源码指纹不够。当前首次启动还会生成新 controller secret/端口；重用旧实例需要安全重建控制器与会话控制权，而非假定旧凭据仍有效。`A/tono/connection/switch.rs:208`；`A/tono/connection/stages.rs:138`、`:182`。
4. `stage_runtime` 的成功回执表示文件已 staging，并非 Mihomo 已实际应用、已选择正确出口且流量走对。现有返回 `config_path` 不能升级解释为采用证明。`S/runtime_generation/staging.rs:237`、`:368`。

因此本轮不添加不完整的热接管分支。若继续实现，必须先补同 owner/session、Core generation/LUID、实际 selector 与家宽应用一致的 Service 回执，和显式 Disconnect 优先的接管边界；最后仍做 native DNS、fake-ip、新鲜 WFP。Service 重启、Core/配置变化、旧/未知证明均不能冒用快路径。原有恢复、重试次数、退避和 stop_core 条件本轮未改，三站仍不在控制路径。

### 11.5 Nits、诊断和验证

- **构建来源不再只靠 0.0.72 标签猜。** App/Service 在 build-time 对明确列出的连接源文件及固定构建属性产生 FNV-1a 64 位诊断标识；读取真实工作树内容，不使用 git HEAD，不把完整源码嵌进二进制，CRLF/LF 统一。目标/配置及 test/development 特征参与区分。它不是密码学签名，也不是完整二进制摘要。`apps/windows/build_support/connection_fingerprint.rs:35`；`apps/windows/app/src-tauri/build.rs:5`；`apps/windows/service/build.rs:4`。
- Service `ProtocolInfo` 新增可缺省的 `connection_source_fingerprint`；旧 Service 缺失时显示 unknown，不误判兼容，也不降低既有能力要求。错误报告显示 App/Service 来源和**稍后探测到的** fresh-proof 能力，不把稍后能力当失败时刻事实。`S/structure.rs:40`；`A/tono/diagnostic_contract.rs:73`。
- **错误分类只认明确标记。** 分开服务身份、协议、繁忙、BFE/WFP、TUN 未就绪、DNS 端口冲突/native/fake-ip、commit 不确定、实际配置变化和旧三站控制流程；笼统 `error sending request`/`RPC timeout` 留 unknown，不猜节点坏了。分类用于诊断，不改 FSM 错误或重试决策。`A/tono/diagnostic_contract.rs:15`。
- 元数据附在既有诊断 `error` 中，保留原错误前缀和清理前证据，预留长度避免长错误挤掉来源信息；保持原上传 schema/字段白名单、脱敏和长度上限。没有真实失败时不伪造 error 来显示指纹；健康状态的 Service 来源仍可由 GetVersion 或启动 trace 得到。上传仍由用户发起。`A/tono/diagnostics.rs:284`。
- 修正旧 PowerShell/CIM 启动预算描述，以及把 `IPC_HANDLER_TIMEOUT` 状态提示误写成实际取消定时器的注释；常量和超时值未变。`S/server/mod.rs:57`、`:86`。
- **App：483 tests；Service：331 tests；指纹工具：3 tests；ConnectPill：9 tests，全部通过。** 覆盖结果不变/不格式化私密错误、取消、独立 trace id、原生状态 unproven、保留所有保护调用、指纹变更/行尾/输入边界、旧字段兼容、诊断脱敏/上限与不影响 admission。
- **Windows x64 Service 生产库 check 通过**（`standalone,client --lib`，不是 `test` 替身）。完整 App Windows 编译仍受本机 SDK C 头文件限制；这里没有 Windows runtime。真实 WFP/DNS/家宽转发、故障注入和提速 50% 均为 unverifiable here。
- `git diff --check` 通过，产品 manifests/lockfiles/版本号未变；未打包、提交、部署、安装、提权或操作远端网络。ROG 未建立可用执行会话，本轮没有重复虚报新的远端验证。


## 12. ROG Windows 实测：2026-09-09（普通权限）

本节替代前文“ROG 不可达”的环境结论，不替代未做的连接/泄漏验收。Orca 远端已经响应，实际执行的是 Windows PowerShell 普通用户会话，工具链使用已安装的 Rust 1.98.1。测试对象来自 **`client/windows-connection-contract` 未提交工作树的文件字节**，不是 HEAD 或 ROG 旧安装包。

### 12.1 Protection blockers：先证实跑的是谁

- 用只读命名管道 GET 核对了服务端 PID 与 SCM 登记的 LocalSystem Service；实回包是协议 **2.15**、build **2.6.7**，但 **`fresh_protection_proof` 字段缺失，`connection_source_fingerprint` 缺失**。随后又用当前工作树的生产 Rust client（不启用 `test` feature）读取 21 次，21 次成功，仍为 proof=false、fingerprint 缺失。这不是本次优化后的 Service，不能仅凭同版本号当成同构建。`apps/windows/service/src/client/windows_identity.rs:31`；`apps/windows/service/src/client/mod.rs:400`；`S/structure.rs:40`。
- 新 App 的必要能力检查会拒绝这个组合；本次未绕过、未删除该门槛，未假绿。缺失诊断指纹本身不判不兼容，真正阻塞的是缺失 fresh-proof 能力。`A/core/service/mod.rs:549`、`:561`、`:577`。
- **IPv4/IPv6、ISP DNS、断核心后物理网卡是否仍封锁：本次未验收。** 没有启动旧客户端去冒充新连接，没有替换/重启 Service，没有给 Orca 加物理网卡放行例外，也没有做可能断掉无人值守远端控制的故障注入。真实 WFP 写入测试保持显式 opt-in 关闭。`S/wfp/real_engine_tests.rs:8`。

### 12.2 Home chain

本次没有产生 AI、家宽或普通业务流量；因此不能从编译/单测推导“所选 VPS → homeSocks5 已实测走通”。有配置不静默回退、无配置走 VPS、TCP-only 与非全站家宽，均须在新 App/Service 组合就位后分别采证。本次未修改家宽或分流逻辑。`C/config.rs:653`、`:664`。

### 12.3 Fast：已测到的组件成本，不冒充点绿耗时

隔离测试目录直接编译当前源码模块，未安装测试 Service。以下都是 **debug 构建、单机小样本**，没有同条件旧构建 A/B；不代表冷连/热连/切节点的 P50/P95，更不能宣布总连接快了 50%。

| ROG 实际执行的路径 | 样本与结果 | P50 | P95 |
| --- | --- | --- | --- |
| 当前生产 Rust client `get_version`，保留实际 pipe PID/SCM 验证，不启用 test 替身 | 21/21 成功；首个调用 2.221 ms | 1.403 ms | 2.221 ms |
| 当前物理默认路由观察 `observe_route` | 30/30 找到物理出口，0 错误 | 0.200 ms | 0.328 ms |
| 当前 `route_diagnostics::observe` 原生路由查询 | 30 次，0 unavailable；不发包 | 0.296 ms | 0.562 ms |

`apps/windows/service/src/client/mod.rs:320`、`:400`；`A/tono/connection/physical_route.rs:108`、`:134`；`A/tono/route_diagnostics.rs:86`、`:110`。P50 取上中位样本，P95 取 nearest-rank；路由循环间隔 100 ms，IPC 循环间隔 50 ms，间隔不计入单次调用耗时。

路由测试使用 RFC 5737 文档地址作为路由查询样本，**不是实际所选 VPS**；fake-ip 样本在没有 TUN 的未连接状态下分类为 Physical，不是一次穿透 WFP 的发包，也不是泄漏测试。没有 Google / Cloudflare / Apple HTTPS 探测。

结论：这两个路由只读步骤在这台机器上都不是秒级成本；不能为了“砍 50%”继续盲删它们。**Service 启动 / WFP 安装 / TUN 等待 / native DNS / fake-ip / 最终 commit 的真实关键路径还没采到**，因为在运行的旧 Service 没有本次实现。§11 的分项计时尚未产生对应实机启动样本。`S/local_timing.rs:42`；`A/tono/connection/stages.rs:277`、`:293`、`:297`。

### 12.4 Stable：有限但真实的运行观察

30 次物理路由观察中首次 Seeded，后续 29 次均 Unchanged，0 Unknown：证明这次约 3 秒的稳定网络样本没有被误判为切网，不等于已覆盖网卡抖动、休眠唤醒、断网恢复或切节点。整个测试没有调用 stop_core，也没有观察到一次恢复事件，不能据此宣称所有恢复都已保核通过。`A/tono/connection/physical_route.rs:59`、`:69`、`:73`。

### 12.5 实机发现并修复的问题、验证证据

- **Windows 专属指纹输入校验缺陷已修复。** 原 `Path::is_absolute()` 在 Windows 上不拒绝 `/tmp/source.rs` 这种有根但无盘符路径，导致原本在 macOS 通过的测试在 ROG 失败（2 passed / 1 failed）。改为 `has_root()`，并统一拒绝反斜杠、盘符及 ADS 冒号形式；固定的相对 Rust 源文件白名单和父目录引用保留。没有放宽输入、更没有降低保护门槛。`apps/windows/build_support/connection_fingerprint.rs:76`、`:122`。
- 修复后 **ROG 指纹测试 3/3、Service 单元测试 317/317、原生路由模块测试 9/9 通过**；Service **Windows 生产库** `standalone,client --lib` check 通过。Service 单测使用 `test` feature 的隔离状态/替身，明确不是原生 WFP/DNS 写入证明。首次离线单测仅因 `matchers 0.2.0` 缓存缺失而无法开始；按原锁文件补依赖后通过，没有改锁文件。
- 同时回归 **本机 App 483/483、指纹 3/3 通过**，这两项是 macOS 执行，不混记为 Windows App 测试。未编译或启动完整 Windows App。
- 收尾再次核对：115 个源文件全部匹配修复后的预期摘要，0 不符，包含的 3 个锁文件未变；已安装 Service 仍运行且 PID 未变，Core 进程数仍为 0，会话仍非管理员。本地 `git diff --check` 通过，产品 manifests/lockfiles/版本文件无差异。
- 初始传输 115 个明确选定的源码/manifest/lock/只读测试夹具，每个文件写入后核对 SHA-256；只进入隔离临时目录，不覆盖 ROG 现有工作树。初始传输摘要 `94490f7eac7b41aaf089c140b35c1a94002d0dea97c3de5310de07dc6960473e`；随后仅同步上述指纹修复，文件 SHA-256 为 `bc1b7de76f037b6499306fed3e359e5cb796ea182719ffad168c885e99331f3d`。IPC 只读 runner 是额外测试夹具，不是产品代码或安装产物。没有读取/传输用户配置、节点目录或家宽凭据。

ROG 关键命令（在隔离测试源码根目录）：

```powershell
rustc +1.98.1 --edition 2024 --test apps/windows/build_support/connection_fingerprint.rs -o fingerprint-tests-fixed.exe
.\fingerprint-tests-fixed.exe
cargo +1.98.1 test --locked --manifest-path apps/windows/service/Cargo.toml --features standalone,client,test --lib -- --test-threads=1
cargo +1.98.1 check --offline --locked --manifest-path apps/windows/service/Cargo.toml --features standalone,client --lib
cargo +1.98.1 test --offline --locked --manifest-path qa/route/Cargo.toml
cargo +1.98.1 run --offline --locked --manifest-path qa/route/Cargo.toml --quiet
cargo +1.98.1 run --offline --manifest-path qa/ipc/Cargo.toml --quiet
```

**未完成的验收不能改写为通过：** 新 App/Service 同树构建组合、完整保护路径的冷/热连与切节点耗时和失败率、断隧道 IPv4/IPv6/DNS 抓包、家宽三种配置条件、真实恢复行为。当前普通用户没有替换受保护 Service 的权限，也不能代点 UAC；没有尝试绕过。此次不打包、不提交、不改版本，不采用“先保护、下一版提速”的发布结论。


## 13. ROG 安装、家宽替换与完整连接实测：2026-09-10

本节更新 §12 的环境限制：用户在电脑前批准 UAC，已通过受支持的 `--replace-runtime` 安装并运行完整 App/Service；不是只编译，也不是安装包或 HEAD 审阅。对象仍是 `client/windows-connection-contract` 未提交工作树。没有 NSIS/打包、提交、版本或产品锁文件变更。以下耗时为 **App 后端 connectBegin → connectOk**，包含保护提交；不是精确的鼠标按下 → 像素变绿时间。

### 13.1 Protection blockers / 验收边界

- 完整基线和后续 WFP 候选均实际 Connected；候选末次新鲜诊断为协议 **2.15**、fresh-proof=true、Service 指纹 **5ac9ce61e779f618**，WFP wanted/verified/live=true、mode=locked、tunnel_permit_rendered=true，DNS enabled/snapshot_present=true，Core 活跃且 restart_count=0。没有靠旧状态或 HTTPS 代替最终保护证明。`A/tono/connection/stages.rs:277`、`:293`、`:297`。
- 手工、连接完成后的 DNS 检验成功：TUN 查询和普通系统查询返回 fake-ip，受禁止的 loopback DNS 查询失败；Service 的 IPv4/IPv6 DNS 原生读回仍保留。此手工工具不参与按钮或监控门槛。`tooling/scripts/probe-windows-protected-dns.ps1:133`；`S/dns/mod.rs:1891`。
- **不能据此宣布“零泄漏已验收”。** 本轮尚未执行物理网卡数据面抓包、Core/Service 故障注入；当前物理网络没有可用公网 IPv6，不能冒充真实 IPv6 外网故障测试。没有给 Orca 增加物理放行。`S/wfp/real_engine_tests.rs:9` 是只读集合资格测试，不是泄漏测试。

### 13.2 Home chain / 只替换当前账号

- 旧配置已在真实 Core 日志确认 SOCKS5 `rejected username/password`；普通 VPS 业务可达而 AI 请求失败，未将其当成“未配置家宽”或静默回落 VPS。用户提供新凭据后先做独立认证测试，再经用户明确“替换”授权更新 **ROG 当前登录账号**。
- 通过已登录的正式后台 API 操作：只创建一个独占 `socks5` 记录并替换该账号绑定，保留默认 VPS、其他用户全部绑定和旧家宽记录用于回退；前后 API 读回确认新记录 bindCount=1。不直接改数据库，不发布整份目录，不部署共享 Worker。`services/control-plane/src/index.ts:1343`、`:1645`。
- 特别避开了现有 `home-exits/assign` 的凭据复用陷阱：相同 host/port/username 命中旧记录时该分支没有更新 password；不能将“assign 200”当成已换密码。本次采用新记录再绑定，未修改或部署这段共享 API。`services/control-plane/src/index.ts:1419`。
- 客户端使用正式“刷新”命令，经验证后的账号目录安装路径处理变更并重新应用家宽，不直接编辑运行配置。配置仍是 `Tono-Home-Residential` 的 `dialer-proxy: Tono-Exit`，仅 AI 分流使用，TCP-only；不是全站家宽。`A/tono/commands/catalog.rs:65`；`A/tono/catalog_sync.rs:153`；`C/config.rs:653`、`:664`、`:871`。
- **应用后的正常 TUN 请求**（`--noproxy '*'`，没有显式 SOCKS 参数）实测：Anthropic API TLS 成功 / HTTP 404 / 0.928 s；OpenAI API TLS 成功 / HTTP 401 / 0.847 s；YouTube HTTP 200 / 0.543 s。4xx API 状态是无 API 鉴权请求的 HTTP 响应，不是 SOCKS 认证失败，也不是付费 API 调用成功证明。Claude 网页 TLS 成功但 **HTTP 403**，不能声称该网页完全可用。候选安装后复测分别为 0.727、0.714、0.563 s，状态相同；Claude 仍 403。家宽物理第一跳与最终出口身份尚未抓包，源配置加业务请求不冒充该项验收。

### 13.3 Fast / 完整耗时优先于组件好看

| 实际完整连接样本 | 全部样本 ms | 成功/失败 | P50 / nearest-rank P95 |
| --- | --- | --- | --- |
| 已安装的完整保护基线 | 779、759、666、674、661 | 5 / 0 | 674 / 779 ms |
| 全层 provider-scoped WFP 枚举候选 | 2870、2844、458、2849、2862 | 5 / 0 | 2849 / 2870 ms |

**提速候选未通过完整连接验收，不能宣布快 50%。** 没有只挑 458 ms 的快样本，没把首次失败诊断的 15 s 当成功基准。两组间按用户要求更换了家宽网关/凭据，虽然默认 VPS 保留，仍不能称为配置完全相同的严格 A/B。后续带额外 DNS 观察器的诊断连接也不混入上表。

1. **已删除的重复成本：每次完整搬运全机无关 WFP 过滤器。** 原生只读实验中，同一 read transaction 的全引擎扫描为 46.56、44.59、45.87、43.95 ms；实时遍历全部 99 个 layer、由 BFE 按 provider 过滤后为 14.07、11.00、11.36、11.99 ms。每轮 Tono 的 15 条过滤器及元数据与全引擎参照一致。仅增大分页无收益，GUID_NULL 作为“全部 layer”模板实机报错，两条错误路线均未采用。`S/wfp/mod.rs:710`、`:715`、`:732`。
2. **保护扫描没删、没缓存。** 实时读取 provider 和所有 layer；包含 disabled/boot-time/legacy sublayer；同一次事务中枚举，共用原有 10 s / 262144 全局预算，任何不完整页都返回失败。fresh commit 和 DNS/fake-ip 均保留。Windows WFP 筛选测试 7/7；另经 UAC 实际运行只读原生 Rust 资格测试 **1/1、非 skip**，当时 Core 活跃，未启用写 permit 的夹具。`S/wfp/mod.rs:715`、`:746`、`:785`、`:792`、`:1027`；`S/wfp/tests.rs:16`；`S/wfp/real_engine_tests.rs:9`。
3. **新主瓶颈是首次系统 DNS 读取时序，不是外网探测。** 候选末轮 WFP lock/TUN permit 31 ms、native DNS apply/readback 58 ms、最终 fresh WFP commit 17 ms；但 fake-ip 步骤 2516 ms，内部包含原有 2 s 首次查询预算、一次约 5 ms 原生读回修复和 500 ms 重试间隔。基线对应 WFP lock/TUN permit 为 191 ms。组件加速真实，总连接反而变慢也真实。`A/tono/connection/probes.rs:209`、`:240`、`:294`；`A/tono/connection/admission_repair.rs:108`。
4. **时序已单独复现，具体底层原因尚未写死。** 只读观察器在“DNS apply/readback completed”审计事件后约 29 ms 发起普通 `DnsQueryEx`：立即及再延后 25 ms 的同名/新名称查询均耗尽 2 s；再延后 100 ms 的同名/新名称查询均约 63 ms 返回 fake-ip。没有指定 DNS server 或 interface，没有 HTTPS，没有改 DNS 设置。因此已证明早期查询会错过随后可用的窗口；尚未用包/ETW 区分 TUN 收包就绪、路由通知与 DNS Client 状态传播，不将猜测写成已确认根因。`A/tono/windows_dns.rs:78`、`:96`、`:115`。
5. 下一次限定修复应针对这个就绪窗口，保留普通系统 DNS 真实成功、原生 DNS 读回与最后 fresh WFP commit；可比较原生就绪通知或能够取消并排空旧查询的有界重叠查询。**本轮没有实施该并发 DNS 方案，没有改原有超时/次数/间隔，也没有用固定睡眠把问题藏起来。** 修改前还需证明取消/代际/显式断开边界，而不是把超时查询留在后台后直接变绿。`A/tono/windows_dns.rs:43`、`:105`；`A/tono/connection/stages.rs:293`。

WFP 模板和事务的 API 依据：[过滤器枚举模板](https://learn.microsoft.com/en-us/windows/win32/api/fwpmtypes/ns-fwpmtypes-fwpm_filter_enum_template0)、[枚举快照与事务](https://learn.microsoft.com/en-us/windows/win32/api/fwpmu/nf-fwpmu-fwpmfiltercreateenumhandle0)。这些文档不代替上述本机集合一致性检验。

### 13.4 Stable / 恢复与人为测试要分开

- 家宽变更触发的是实际配置变化 `HomeRoutingChanged`，不是网卡噪声；不能保留旧 Core 配置假装新家宽已应用。`A/tono/catalog_sync.rs:153`、`:161`。
- 本轮 5 次基线和 5 次候选连接是人为“断开→连接”；安装/回退也通过显式断开确认 Core 已退出、DNS 已恢复、WFP wanted/live=false 后才关闭 App，再由受支持 helper 替换运行时。没有用强杀 Core 模拟成功恢复，也没有修改任何恢复 stop-core 条件。
- 候选末轮 restart_count=0、保持 Connected 是有限的运行观察，不证明休眠、换网、网卡抖动或 Core crash 均已保核。首次 DNS 修复只做当前 owner/Core 身份检查和 DNS 读回，不 stop_core、不释放 WFP；三站 HTTPS 仍不在控制路径。`A/tono/connection/admission_repair.rs:44`、`:108`。

### 13.5 Nits / 构建来源与未完成项

- 完整基线 App SHA-256：`b543a7ec80e5455f462efec243ee92f6b1d016b6a96417168eea764439d12ce3`；Service：`baa75a23069dc2df28c58eeff9dde2ae44711becd2ed9286d04ae79dc7e4c40c`，来源指纹 `8abddef493beaec3`。
- WFP 候选 App：`c40e67f7c7777aa882935ecbde59a3c2eb98562b109c6a32d2a48ed045c8e95b`；Service：`9828e4e9cc11a4d55be452ebf7e496716c20befd3a7461ccb0fdbbfcaed0c443`。均为完整 release、0.0.72；没有 dev/test/clippy 替代 App，没有改变 Core pin。当前候选源码保留在未提交树，性能不合格不等于悄悄撤销用户已有代码。
- `EnumBudget::charge` 的旧注释仍写“先消费/释放后 charge”；新 filter/layer 页实际先 charge、再解析，统一 free 后传播错误，运行逻辑未漏 free，但注释有待随下一次源码构建校正。本次没有为改一句注释让已测二进制与源指纹暗中脱节。`S/wfp/mod.rs:680`。
- 物理 IPv4/IPv6/DNS 泄漏、断核心锁定与真正故障恢复、严格同配置完整连接提速 50% 仍未验收。失败的速度候选不作为通过结果，不形成“保护现在发、速度以后做”的发布结论。

### 13.6 ROG 最终安装状态

**回退没有完成，ROG 当前仍是上述 WFP 候选，不是基线。** 回退启动返回 `launched=false / InvalidOperationException`，未得到管理员安装回执；没有把失败的启动请求算成成功，也没有绕过 UAC 或自行重复请求。基线备份仍保留，新家宽账号绑定不回退。

已只读确认当前 App SHA-256 为候选值、Core pin 匹配，SCM Service Running、无 `.next` 待提交文件。普通用户不能直接读取受保护 Service 二进制；因此当前 Service 以经过 pipe PID/SCM 身份验证的生产 IPC 和候选来源指纹交叉核对，未伪造普通权限下的重新 hash 结果。之前管理员安装阶段的 Service SHA-256 验证仍单独保留。

随后以普通权限重新打开 App 并点击连接：UI 已 Connected；当前 Core 活跃、restart_count=0，WFP wanted/verified/live=true、locked、tunnel_permit_rendered=true，DNS enabled/snapshot_present=true，两者均无 last_error。**恢复可用连接不等于通过速度或泄漏验收**；完整提速 50% 和上述 DNS 首查窗口仍未完成。回退安装须用户确认后续管理员启动，不能自动绕过。

回退启动失败后重新连接的最终业务复测：Anthropic API HTTP 404 / 0.606 s、OpenAI API HTTP 401 / 0.687 s，均 curl=0、TLS verify=0；普通 VPS 业务 HTTP 200 / 0.669 s；Claude 网页仍 HTTP 403。手工 protected DNS 检查同时通过，证明新家宽在重开客户端后仍生效，不构成网页反机器人限制、出口身份或物理泄漏验收。


## 14. DNS 首查窗口修复与用户要求的最新测试安装包（2026-09-10）

### 14.1 Protection blockers

- **保留完整入口：** DNS native apply/readback 与 Core identity 均通过后才做普通系统 fake-ip；之后仍必须重新验证 WFP 并提交相同 Core/session/generation 的保护承诺。没有添加 Google/Cloudflare/Apple HTTPS 门槛、指定 DNS server/interface、物理网卡放行或 IPv6 例外。`A/tono/connection/stages.rs:277`、`:293`、`:297`；`A/tono/windows_dns.rs:252`。
- **已修异步查询生命周期：** 超时、连接取消或过期 future 的 Drop 都请求 native cancel；worker 持有 DNSAPI buffers 和进程内 batch lease，必须等回调真实结束才释放。一个 native batch 不退场，后续重试不能无限堆积新 worker。回调的 notify 移到 mutex 解锁前，避免 worker 看到 outcome 后释放 context、回调却继续访问 Condvar。`A/tono/windows_dns.rs:35`、`:97`、`:111`、`:123`、`:286`、`:315`。API 的取消返回不代表回调已结束，参见 [Microsoft DnsCancelQuery](https://learn.microsoft.com/en-us/windows/win32/api/windns/nf-windns-dnscancelquery)。
- **防止“最快返回就放行”：** 非空且全部 A 地址在 `198.18.0.0/16` 才能证明 fake-ip；赢家不能掩盖落后查询中的真实地址、未知 OS 错误、worker 失败或未收回取消。必须 drain 后合并证据。`A/tono/windows_dns.rs:166`、`:197`、`:224`；`A/tono/connection/probes.rs:264`。
- **仍待实机验收：** 没有新增物理网卡抓包与 Core/Service 故障注入，不能写成 IPv4/DNS/IPv6“零泄漏已过”。ROG 的 overseas 结果也不代替国内测试；此前现场无 global IPv6，不能据此通过真实 IPv6 外泄用例。

### 14.2 Home chain

- 本轮只改 App DNS wrapper 与 admission 调用点，未更改路由、账号、默认 VPS、家宽绑定或 Core pin；第 13 节已应用的新 SOCKS5 绑定保留。仍是仅指定 AI 流量 `客户端 → 所选 VPS → homeSocks5`；未配置不添加第二跳，坏配置不解除绑定。`C/config.rs:653`、`:664`、`:862` 中现有 route/dialer 规则未被本轮修改。
- 测试包按显式程序资源 allowlist 构建，不复制 ROG AppData、账号、catalog、owner token 或家宽凭据。NSIS payload 检查独立于编译成功，必须通过才交付。`apps/windows/app/src-tauri/tauri.conf.json:14`、`apps/windows/app/scripts/windows-release-preflight.mjs:306`。

### 14.3 Fast：时序证据与同配置基线

- 只在 **admission 的第一个 attempt 仍 pending** 时增加一次新的普通系统查询。第一条立即成功不等 timer、不增请求；两条均保留完整 2 s 预算；后续两个 5 s attempt、500 ms 重试间隔和至多一次 native DNS refresh 原样保留。monitor 不启用这一额外查询。删除的是卡在过早那次查询上白等整轮的依赖，不是删 DNS/WFP 验收或切短失败预算。`A/tono/connection/probes.rs:182`、`:206`、`:221`、`:243`、`:301`；`A/tono/windows_dns.rs:148`。
- 第一版 100 ms 候选已完成 NSIS 构建、payload preflight，但 **未交付、未安装**：只读 native 观察出现 2120 ms / timeout，证明 100 ms 在本机仍可能过早。不能把早先一个成功样本当作稳定方案。
- 随后的五个独立、有限生命周期 QA 进程只做普通系统 DNS，实际启动时刻相对 DNS readback 为 **35、81、132、205、312 ms**：前两条各 2002 ms 超时，后三条分别 **50、2、1 ms** 返回全 fake-ip。所有子进程已退出。该实验不改网卡/DNS/WFP、没有 HTTPS，也不混进完整连接统计。
- 因此额外查询设为 **150 ms** 后再发，仍是调度时机而非“150 ms 就 ready”的判据。直接复用修正后的生产 wrapper，ROG 观察到 readback 后 31 ms 开始，**154 ms 完成且全 fake-ip**；native loser 已取消并收回，否则函数不能成功。这个数字只代表 DNS 组件，不是完整连接提速百分比。`A/tono/windows_dns.rs:36`、`:152`。
- 同网、同 VPS、同一新家宽配置、无编译与额外 observer 干扰的当前已安装 WFP 候选完整基线：**2906、2899、2857、2888、2885 ms**，5/5 进入 UI Connected；P50 **2888 ms**，nearest-rank P95 **2906 ms**。第五次 DNS fake-ip **2524 ms**、native refresh **6 ms**、WFP/TUN **33 ms**、DNS apply/readback **56 ms**、最终 WFP commit **17 ms**。这是 `connectBegin → connectOk` 全保护入口，不是精确 click-to-paint。
- 修正版完整安装后的同配置计时尚待本轮后续结果；不拿 failed 15 s 诊断当基线、不挑一条最快值、不与第 13 节不同家宽配置的 674 ms 基线混算 50%。剩余优化应按 Service bootstrap/Core、TUN/WFP、native DNS/fake-ip 分桶取全样本，再删同一保护路径上的重复工作。

### 14.4 Stable

- 本轮没有增加 stopCore、Service restart、切网络/切节点或 selector 操作。只用同一 native query 的真实 cancellation handle 回收 DNS worker；monitor 保留原路径，recovery 的 generation/single-flight/保护 commitment 未改。`A/tono/windows_dns.rs:123`、`:286`；`A/tono/connection/probes.rs:181`；`A/tono/connection/admission_repair.rs:26`。
- “绿了不跳”不能由短时 Connected 截图推出。源代码保留相同 session/generation 验证；长时间稳定与故障保持封锁仍按实际完整连接用例验收。`A/tono/connection/stages.rs:291`、`:296`。

### 14.5 测试与打包约束

- Windows 独立 native wrapper 测试 10/10。完整 App `tono::` 测试首次 286/287：一个新测试使用 15 ms 墙钟来保证先后，在并发 Windows test runner 下失效；改成明确的 Notify 握手，而非改产品超时或降低断言，随后 287/287 通过。150 ms 最终源再次完整复测 **287/287，通过**；没有降低原 2/5 s 产品预算。最终安装包结果继续记录在下一小节。
- 第一次打包检查发现 ROG QA 缺少测试引用的四个 workflow/build-script 文件；从当前工作树补齐并逐文件 hash 验证后通过，未跳过测试。Windows 使用 `pnpm.cmd` 正常入口，没有修改 PowerShell execution policy。
- 837 个 build/source 输入与本地工作树逐 SHA-256 一致；唯一排除的是未引用且不在打包 allowlist 的 `SF-Pro.ttf` 源资产。前端从当前源代码重新构建，plugin JS 也重新构建；不沿用旧 dist 伪装最新。Core pin 和已原生验证的 Service/helpers 没有替换成其他版本。
- 用户这次明确授权打包；版本仍 0.0.72，不提交、不运行 release-version、不发 GitHub Release、不推进 updater channel。交付只能标为测试包，不能由 NSIS 成功推导整个保护/速度合同通过。


### 14.6 最新可转发测试安装包

- **已构建并交付 ROG 桌面**：文件夹 `Tono-0.0.72-dns-fresh-20260910`，安装程序 `Tono_0.0.72_x64-setup.exe`，**24,835,014 bytes**。另附 `SHA256SUMS.txt`、`candidate-manifest.json` 和 `README.txt`；未加入用户资料、日志或 QA 工具。
- 安装程序 SHA-256：`271f6f8e7b38a64efebc65b88b29c4f9eed6afecb2fdd0e9f5fdbba5c71292c6`。已复制到交付位置并重新 hash；版本仍 0.0.72，Authenticode **NotSigned**，updater 未签名/未发布，只能标为测试包。
- 最终生产 DNS 源 SHA-256：`f8451d982c5e1b520cd7e9fd21e96f26c49b432adbb33167362491b029aa1103`；837 个输入在打包后再次逐文件核验，source-manifest digest：`cd45e8eb4c98f8af38463bdc8895a7e3b1bfb1154fa384a67105e7a5824ec71c`。完整 App Windows `tono::` **287/287**；packaging/config、dev-control/packaging tests、ConnectPill/update tests、前端 typecheck/build、NSIS build 和 payload preflight 均成功。
- **不是只检查“包里有 exe”：** 抽取 NSIS 中 App、Core、Service、install helper、uninstall helper 五个真实 payload，与编译来源逐字节/逐 hash 核对。App 原始 release SHA 为 `52fb3564051d4e6c4ca6e1b3a536cd68fca18a2c6ca72ee1aa61b53bc77c2899`；包内 SHA 为 `d43e72cf2bba60d8f459a885ccb4a1a31cf0c44e4bcd02f5fbb92ae7b1fa1149`。唯一差异为 `.rdata` 的三个字节：Tauri 官方 bundler 把唯一 `__TAURI_BUNDLE_TYPE_VAR_UNK` 改成 `..._NSS`，其余 **31,367,165 bytes** 相同。校验器要求唯一 marker、严格匹配这一个转换及所有其他字节，并非遇到 hash 不符就忽略。见 [Tauri bundler 的 patch_binary](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle.rs)。Core 与三个 Service binaries 完全匹配第 13 节已验证 SHA，Core pin 未变。
- 已显式断开旧连接，生产 IPC 验证 DNS 已恢复、WFP wanted/live=false、Core=0 后，才关闭已知 SHA 的旧 App；没有通过杀 Core 代替 Disconnect。旧 App 候选另存带预期 hash 的备份，此前受保护基线备份仍保留。随后只启动这份经 hash 验证的 NSIS `/S` 安装程序；管理员 UAC 必须由用户确认，不能绕过。
- **安装自动启动失败**：`launched=false / completed=false / InvalidOperationException`，没有得到安装执行回执；只读核对仍为旧 App `c40e…`，新 App 未装入，没有 consent/installer 进程，也没有 App/Core 活动进程。不能确定具体是取消还是其他系统启动错误，不把它说成已获管理员同意，也不自动重复 UAC 请求或绕过执行策略。安装包已在桌面且 hash 校验通过，用户可手动断开/退出旧 App 后运行新包。
- 随后经已安装 App/Core hash、Service Running 与经过身份核验的 IPC 再次确认旧安装组合、无待提交 `.next`，才用普通用户重新打开旧 App；原家宽绑定和所有备份保留。最终 UI 为待机，生产 IPC 显示 Core 不活跃、DNS 已恢复、WFP wanted/live=false；用户随后明确告知已断开，因此保持断开，不再自动重连。
- 新包完整连接 P50/P95、物理泄漏和国内环境结果仍未记录；未宣称全产品提速 50% 已验收。交付成功与管理员安装成功分开记录。


### 14.7 用户手动安装后的只读核验（2026-09-10）

- 用户报告安装完成后，ROG 只读核验确认已安装本节新 NSIS payload App（SHA-256 `d43e72cf2bba60d8f459a885ccb4a1a31cf0c44e4bcd02f5fbb92ae7b1fa1149`），不再是前一候选 App；Core 固定哈希匹配，无待替换文件。
- Service Running；身份校验后的生产 IPC 返回协议 2.15、fresh-proof 能力及预期指纹 `5ac9ce61e779f618`。本次未以普通用户重新读取受保护的已注册 Service 可执行文件哈希。
- 核验时 Core inactive、DNS disabled、WFP wanted/live=false，无 DNS/WFP 错误；符合用户明确断开的状态。没有自动连接、安装重试或网络变更。
- 尚未取得新安装 App 的完整连接后测样本；150ms DNS 组件实测不能替代全流程 50% 提速证明。物理 IPv4/IPv6/DNS 泄漏与断隧道故障资格验证仍未完成；国内只能作为知情小范围、非敏感内测，不能据此宣称正式发布或保护/速度目标已完成。


## 15. 默认自动、脱敏、离线补报的连接诊断（2026-09-10）

用户明确要求不等待客户逐次确认。本节为当前工作树的新改动，**不在第 14 节已交付安装包中**；本轮没有打包、安装、提交、改版本、发布更新或部署后端。

### 15.1 Protection blockers / 现场证据

- 客户截图证明 Tono 在 Mesa 显示已连接时，Edge 的一个站点出现 `ERR_CONNECTION_CLOSED`；“所有网站不可用”来自客户描述。用户明确确认上海移动公网 IP 截图是在连接之前取得，不能把它当作连接后漏 IP 的证据，也不能由此判定移动不支持 TLS、必须改 UDP。
- Mesa 运维接口只读结果为节点 agent online、quality OK；它不证明上海客户到 Mesa 的 Reality 握手/实际转发成功。本轮没有取得该客户 Core 原始日志、Service 日志或抓包，故障根因仍未确认。
- 自动诊断只读，不创建物理 API/DNS/IPv6 例外；上传复用现有受保护 API transport。完全断网时先排队，通路恢复后自动补报，不承诺封锁状态也能即时送达。`A/tono/automatic_diagnostics.rs:441`、`:512`。
- 状态明确区分本地保护与远端可用性：`remoteReachability=notObserved`；只读失败/超时保留 App 已有失败类别和步骤，缺失的 Service/DNS 数据保持未知。`captureConsistent` 只表示采样窗口的身份/WFP 前后检查一致，不是抓包证明。`A/tono/automatic_diagnostics.rs:248`、`:283`。IPv4/IPv6/DNS 零泄漏资格仍待实机验证。

### 15.2 Home chain

- 不改路由或 homeSocks5 绑定，不添加家宽探测/物理放行/全站家宽。自动摘要只记录是否配置家宽、配置与 applied routing 是否一致，以及 selector 是否仍为所选 VPS；不读取并上传家宽地址、用户名或密码。`A/tono/automatic_diagnostics.rs:114`、`:188`。
- 这些字段不证明某一条业务实际经过家宽，也不证明家宽出口可用。仍应按“指定 AI → 所选 VPS → homeSocks5、坏配置不解绑”解释，不能把 `homeAppliedMatches=true` 当作 SOCKS5 握手成功。

### 15.3 Fast / 自动采集与发送

- 新开关默认开启，并在设置中明确说明、可关闭；旧的可选时间线和原始流量日志上传仍默认关闭，没有用一个同意替代原始日志授权。`A/tono/audit.rs:488`、`:721`；`apps/windows/app/src/pages/settings.tsx:287`、`:348`。
- 在已有登录恢复/登录成功入口启动唯一后台任务，生命周期事件唤醒；每 15 秒观察已连接/保护离线/失败状态，连接和断开过渡期不发起新采样或上传。连接步骤从现有计时记录读取，不往 Service/WFP/TUN/DNS/fake-ip admission 链增加等待或三站探测。`A/tono/telemetry.rs:115`；`A/tono/automatic_diagnostics.rs:44`、`:130`、`:512`。
- 报告含 App/Service 源指纹、Service 协议/能力、连接阶段耗时、失败类别、Core/session 标识、WFP mode/wanted/live/verified/TUN permit、DNS 状态、局部 route class、selector 一致性、活动连接数、收发累计字节，以及当前 Core 100 行 ring 中的错误类别/计数。Controller 只读固定 loopback 地址、禁代理和重定向；流 metadata 在本地丢弃。`A/tono/automatic_diagnostics.rs:188`、`:248`、`:283`；`A/core/service/mod.rs:303`。
- 首份采样保留约 15 秒合并窗口；变化摘要限频发送，不再等旧的首次 5 分钟/周期 20 分钟任务。计数增长、正常流量和 ring 顺序变化不重复触发上传；相同错误类别出现更多行不是更多独立事故。默认最多 4 次/小时、48 次/日，显式启用旧时间线时预留其服务端配额。发送预算限制意味着“自动”不等于实时保证。`A/tono/automatic_diagnostics/model.rs:279`；`A/tono/automatic_diagnostics/outbox.rs:160`。
- 这些是诊断改进，不是新的全连接提速成绩。新增后台 IPC/loopback 采样对 Windows 的实际开销尚未测量；第 14 节 DNS 组件与全流程基线不得混算为 50% 提速。

### 15.4 Stable / 队列、身份与隐私

- 不调用 stopCore、tunnel_died、mark_verified、release 或 owner 恢复；Core 日志只读采用现有小 ring，不自动调用会尝试 owner 恢复的完整日志快照 helper。采样前后核对 App 登录/连接 generation、Core PID/generation/session 和 WFP 状态；晚到结果不混入新的连接。`A/core/service/mod.rs:303`；`A/tono/automatic_diagnostics.rs:283`。
- 磁盘仅保存受严格 enum/数字/布尔/限定节点标签约束的摘要，按账号 SHA-256（base64url）分区，Windows 使用现有私有 DACL writer；队列最多 24 份、256 KiB，7 天过期，运行时清理、过期不发送。临时文件 fsync 后原子替换，拒绝链接/重解析点，溢出计入丢弃数。`A/tono/automatic_diagnostics/model.rs:247`；`A/tono/automatic_diagnostics/outbox.rs:55`、`:117`、`:188`。
- 先持久化再上传，成功确认后才出队。账号切换时请求固定原账号 token，并重新检查登录代际；401 不刷新成另一个账号的 token。关闭开关/本地审计会停止发送，清理 feature 队列，并持久化 privacy epoch：即使删除失败或关机打断清理，重新开启也不能复活旧队列。正常退出不是退出授权，不清掉待补报数据。`C/auth.rs:983`、`:1001`；`A/tono/audit.rs:721`；`A/tono/automatic_diagnostics/outbox.rs:110`。
- 复用已部署 `periodic_window` schema，单批最多 3 个快照、200 个事件、48 KiB；每个快照携带独立时间、phase 与稳定 reference，避免批次中不同节点/阶段被误合并。后端没有幂等去重，本轮是 at-least-once，重复 reference 和重叠 ring 计数不可累加成事故次数。`A/tono/automatic_diagnostics.rs:412`；`A/tono/automatic_diagnostics/model.rs:314`。

### 15.5 Nits / 验证与尚未完成

- 修复测试发现的队列清理缺陷：最初把 `catalog_digest` 当 64 位 hex，实际为 43 字节 base64url，导致关闭开关后漏清理；现在按实际编码匹配。并发隐私设置读改写串行化；privacy epoch 原子值只增不退。`A/tono/automatic_diagnostics/outbox.rs:55`；`A/tono/audit.rs:532`。
- 当前本地 macOS App `tono::`（`--features clippy`）**293/293** 通过；账号 token 固定/401 不串号测试 **2/2** 通过。覆盖离线持久化/重启/配额、关闭清理与 interrupted-delete 防重放、恶意自由文本/链接拒绝、loopback metadata 丢弃、固定失败类别和阶段耗时、无 FSM/原始日志控制调用等。
- 由 Rust 测试生成纯合成 wire fixture，交给现有 Worker 实际 validator、D1 入库和管理员列表读取测试，新旧通道用例 **2/2** 通过；不是只比对两个手写 schema。`services/control-plane/test/worker.test.ts:6943`；`services/control-plane/test/fixtures/windows-automatic-diagnostics-v1.json`。前端 i18n/typecheck、后端 typecheck 均通过。服务端运行时代码、接口和数据库 schema 未改，仅新增本地测试。
- **Windows 实机仍未验证：** ROG 只读终端首次访问超时，一次重试返回 `remote_runtime_unavailable`。没有 source transfer、Windows 原生测试、安装、UAC 重试或自动重连。本节代码不在客户旧包，不能说客户已经自动上报或 Mesa 故障已经修复。
- 当前摘要不包含 OS edition/build、逐流目标/进程、Core 原始错误或预清理日志全文；未记录的转发停滞仍可能只能得到“远端未知”，TLS/timeout/closed 仅是日志中观察到的类别，不定位为运营商/Reality 根因。旧手动 report 的 error 长度上限（客户端 2000、后端 500）仍是独立缺口；新自动通道不借用该自由文本字段，也未静默放宽后台隐私限制。`A/tono/automatic_diagnostics/model.rs:408`；`A/tono/diagnostics.rs:56`；`services/control-plane/src/index.ts:3541`、`:3578`。


## 16. 同一 VPS 的 Hysteria2 备用入口（客户端接线，2026-09-10）

本节只针对 `client/windows-connection-contract` 的未提交工作树。按用户确认新增第一跳 UDP，但家宽分流不变。默认仍为 TCP/REALITY，先提供显式协议选择；未实现自动竞速/自动切协议，也未修改线上节点、账号、证书、防火墙或发布目录。不是新的安装包，也不是上海移动故障已修复的结论。

### 16.1 Protection blockers / 保护

- 新增的是父 VLESS 节点内的 `tono-hysteria2` 扩展，不是把共享目录换成一批旧客户端不认识的顶层代理。公共 IPv4 与逻辑节点名继承所选 VPS；只接受固定 UDP 端口、认证密码、TLS SNI、可选 Salamander 密码。未知扩展字段、空/超长/控制字符凭据、无效端口或 SNI 都拒绝；声明但无效不能当作缺席。禁止跳端口、另一个 server、STUN/Realm、任意 dialer、关闭证书校验与 TLS 验证覆盖。`C/node.rs:199`；`C/node/hysteria2.rs:55`、`:121`。
- TLS 仍验证 CA 链与 SNI。HY2 不是“不要 TLS”，也不能沿用 Reality 的第三方伪装域名却没有对应证书。采用固定版 [Mihomo v1.19.29 适配器](https://raw.githubusercontent.com/MetaCubeX/mihomo/v1.19.29/adapter/outbound/hysteria2.go) 支持的字段；没有引入新的核心依赖或更换客户 sidecar。
- WFP 端点和运行时从同一个 transport 快照生成，只给 **staged Core → 所选 VPS IPv4:UDP 端口** 放行，不允许普通进程、其他地址/端口、TCP 冒充、物理 DNS 或 IPv6 借此通过。原 Service WFP 算法不改，只新增模型回归。`A/tono/connection/endpoints.rs:15`；`apps/windows/service/src/core/wfp_model.rs:2080`。
- Connected 仍必须经过原 Service/WFP/TUN、受保护 DNS 实际应用、系统 fake-IP 和 fresh commit；没有增加三站探测、缩短保护超时或跳过 barrier。`A/tono/connection/stages.rs:280`、`:295`、`:300`。**Windows 物理 IPv4/IPv6/DNS 抓包、核心崩溃和断隧道实测：unverifiable here。** 模型通过不等于零泄漏资格已获证明。

### 16.2 Home chain / 不动家宽分流

- 仅第一跳由 VLESS/TCP 换成 HY2/UDP；指定 AI 的 TCP 仍为 **客户端 → Tono-Exit（所选 VPS）→ Tono-Home-Residential（homeSocks5）**。不做家宽物理放行、不把 SOCKS5 放进 TUN 排除地址、也不把普通网站全改成家宽。`C/config.rs:504`、`:683`。
- 有/无家宽 × 有/无可选 DIRECT 的四组合回归逐项比对：规则顺序、DNS、TUN、IPv6、代理组、SOCKS5 链和 DIRECT 出口均不变，只有 VPS outbound 的传输字段不同。普通 payload UDP 仍按原规则拒绝，不能因载体是 QUIC 就绕开 AI 的 TCP-only 家宽。`C/config.rs:2362`。
- 不支持 UDP 的所选节点明确报错；UDP 运行时 selector 不混进隐式 TCP fallback。坏家宽或旧 homeProxy 仍报错，不转成“未绑定”。`C/config.rs:2410`、`:2423`。
- Worker 的真实加密目录/按账号替换/绑定读取测试确认：嵌套 HY2 password 使用账号 UUID 占位符后，各账号得到不同身份；homeSocks5 只给绑定账号，坏绑定返回 503。服务端运行时代码与 schema 没改。`services/control-plane/test/worker.test.ts:3291`。现有国内可选 DIRECT 开关仍保持原值（关闭），本轮没有借加协议更改国内路由政策。

### 16.3 Fast / 不增加绿色前的串行工作

- 不是“先 TCP 等失败再等 UDP”的双重超时链：设置中先选一个载体，沿原本一条保护事务执行。默认 TCP 配置与添加扩展前字节相同。没有新增 Service IPC、公共站点确认或连接前 UDP 探测。`A/tono/exit_transport.rs:109`；`A/tono/connection/stages.rs:184`；`C/config.rs:2404`。
- 运行时筛选使用借用节点列表，避免为了 transport 再复制整份凭据图；一次已应用图快照用于热切节点，不从控制器重新下载 YAML。`C/config.rs:563`；`A/tono/connection/stages.rs:337`。
- 首绿的本地长尾仍优先量 Service 启动/资产与身份检查、WFP 事务/枚举、TUN ready、DNS apply/native fake-IP；沿现有各阶段计时和 source fingerprint 做冷/暖连接 P50/P95，和断网/故障注入分开计。现有准备期、controller+lock、DNS+本地证据并行保留，本轮没有靠删 WFP/DNS 伪造提速。`A/tono/connection/stages.rs:127`、`:248`、`:280`。
- **没有新的 Windows 全流程耗时样本，不能宣称提速 50%，也不能把 HY2 离线解析的耗时当连接耗时。** 是否改善上海移动需要相同 VPS、相同家宽绑定的 TCP/UDP 对照，记录真实握手/转发成败与耗时，不以三站失败干预连接状态。

### 16.4 Stable / 已下载不等于已应用

- 协议只能在完全断开且保护已释放时更改；保存成功后推进原 connect generation，退役尚未 latch Connecting 的旧快照，并取消断开态 TCP 测试。连接中、保护离线、断开中不可用修改设置绕过当前 WFP。原 single-flight/恢复所有者不改。`A/tono/exit_transport.rs:109`、`:146`。
- 新记录已应用 transport 和实际 selector 节点图。热切换基于这份图产生 old/new WFP tuple；刚下载的节点端口/协议/认证字段若尚未加载，不再对着旧 Core 放行新端点，而是走现有保留封锁的受控替换。可选 DIRECT reload 同样携带原 transport，不会静默重置为 TCP。`A/tono/connection/switch.rs:154`、`:165`、`:176`；`A/tono/connection/direct.rs:492`。
- 恢复读回还须匹配当前已应用载体；只改变未使用的 UDP 备用描述不会重启健康 TCP，反向亦然。不是网卡一抖、网站一次 TLS 超时就停核心。`C/node/hysteria2.rs:86`；`A/tono/exit_transport.rs:79`；`A/tono/connection/monitor.rs:693`、`:898`。
- 自动摘要新增 requestedTransport/appliedTransport 两个固定枚举事实；仍明确 remoteReachability=notObserved，不把“配置已加载”冒充握手成功。手动报告扣除当前和已应用图里的 HY2/home 凭据；HY2 Debug 和本地 redacted runtime 不输出认证/混淆密码。`A/tono/automatic_diagnostics.rs:280`；`A/tono/commands/diagnostics.rs:171`；`C/node/hysteria2.rs:27`。

### 16.5 验证与交付边界

- 本地 tono-core **236/236**；App `tono::` **297/297**；Service `--features standalone --lib wfp_model` **35/35**。覆盖固定 tuple、IPv6/DNS/普通进程拒绝、缺失与坏扩展、坏家宽不降级、协议更改互斥、下载/应用图不一致、未使用载体变更无重建、凭据脱敏与旧 TCP 配置不变。
- [官方 v1.19.29 发布资产](https://github.com/MetaCubeX/mihomo/releases/tag/v1.19.29) 的 Darwin/arm64 校验二进制经资产 SHA-256 核对，实际 builder 生成的四种完整运行时全部 `mihomo -t` 通过。**仅离线解析，不启动 Mac TUN、DNS、代理或网络会话；不是 Windows sidecar 实测。** 本机原有核心是不同版本，未拿它冒充固定版本校验，也没有替换它。
- 目录 publisher `--dry-run` 通过（只用合成内容，不读 Keychain、不访问线上）；Worker 新 UDP+家宽和自动诊断/旧时间线三项 **3/3**；前端 i18n/typecheck、后端 typecheck 通过。Rust 生成的自动上报 fixture 已包含请求/应用载体不一致的例子，实际 Worker validator/D1/admin 读取仍接受。
- 本轮中途系统开始拒绝读取 Git 元数据，故最终 `git diff --check` 无法复跑；没有改权限、修 Git 元数据或更换工作树。文件级检查覆盖本轮触及源码，无冲突标记、无行尾空格，并保存文件 SHA-256 与测试证据。开始时已确认是指定分支未提交树；版本仍为 **0.0.72**，未提交、未打包、未安装、未发布。
- **上线前仍缺：** 同一 VPS 的 HY2 服务、可验证 SNI 证书、按账号认证/撤销与计量、精确 UDP 服务端防火墙规则，以及不破坏旧客户端的受控目录发布；需另行远端变更批准和回滚计划。随后才可在 Windows/国内移动跑完整连接与家宽链、断隧道和 DNS/IPv6 泄漏资格。当前客户旧安装包不含本节代码，没有可用的线上 UDP 入口就保持 TCP，不能把新增客户端设置当成已经修好客户断网。
