## 2026-09-30 · 粘性自愈在屏障外换出口，普通失败放回原网络

- 归属：SHIP_PLAN 客户连接路径（零配置出口）。不是 G4 发布项，不发客户包。
- 来源：`main` `d2363002` → 本分支；未合 main。
- 缺陷修复：无单独客户缺陷单。连接失败后如果已经有已验证的屏障，自愈不再在重试间隙拆系统路由，也不再停在 Protected Offline 里轮换节点。
- 新增/优化：记忆的拨号目标只在保护未武装时使用。顺序是同一节点的另一传输 / 端口 / SNI / 解析地址，然后同一地区里延迟最低的 TCP 节点。住宅 SOCKS 身份不换。东京 ` · hy2` 不自动选。回到首选节点要两侧都满 45 秒。普通模式用现有的显式释放恢复原网络，一次，不再自动重连。只有用户明确打开的严格 kill switch（macOS「永久」）才保持封锁并重试同一节点；Windows 没有这个开关，按普通模式处理。恢复连接在装隧道前最多等 2.5 秒 TCP，第一次连接不等这一下。
- 工程与测试：`tono-core` `heal` 与 macOS `ExitHeal` 各一组决策测试（顺序、粘性、滞回、失败即开放、严格保持、超时预算）。没有表驱动测试。
- 验证：本机 Cargo 1.83 解析不了工作区 edition 2024（工具链要求 1.98.1），`cargo test -p tono-core --lib heal` 未执行。macOS XCTest 未在本机跑（无 Xcode）。预算不是实机握手：串行阶段预算合计 47000 ms，重叠后的失败预算合计 35000 ms（配置/DNS/TCP/QUIC/鉴权取最大 5000 ms，TUN 10000 + 路由 8000 + 首字节 12000）。各阶段 after：config 0、dns 2500、tcp/quic 预检 2500、tun 10000、route 8000、hy2 quic+tls 5000、auth 5000、first-byte 12000。
- 候选/发布：仅源码，无新候选。
- 剩余限制：健康监视器里原有的失败闭合重连没有改，实机上它仍可能在释放之后再次武装。macOS 决策类型未接到 `AppState`。没有 Niagara/Erie 实机 hy2 计时。释放失败时屏障仍可能留着（既有释放失败行为）。#663 的 20 秒路由等待在 `release/windows`，本分支不改那段。

### 2026-09-30 续记 · 住宅身份先转成 String 再比较

- 缺陷修复：`stick_to_preferred` 在 `residential_id` 仍是 `impl Into<String>` 时和 `String` 比较，托管 CI 的 `core` 与 `app-rust` 编译失败。现在和首选节点一样，先 `into()` 成 `String` 再比较。两边都相等才保留绕行；住宅身份变了仍丢掉绕行并换上新身份。比较没有放宽。
- 验证：本机 Cargo 1.83 仍解析不了 edition 2024，`cargo test -p tono-core --lib heal` 未执行。推送后等该 head 上的 `core` 与 `app-rust` 变绿。

### 2026-09-30 续记 · 与 #706 共用耗尽后的网络决定

- 新增/优化：普通失败放回原网络、严格模式保持封锁，不再在本模块里单独 match。两者都调用 `network_disposition::exhausted_protection_using`。这个函数的所有者是 [#706](https://github.com/raydocs/tono/pull/706)。本 PR 只消费它。钩子就绪时结果是 `SelectiveAiHold`：放行一般流量，不调用显式全量释放，AI 服务流量继续被挡。钩子未注册时仍是今天的 `FailOpen`。PF/WFP 规则归 bc-3c5ccfd4。
- 剩余限制：#706 的 `plan_failure` 合入后，若它已经按同一决定释放过，本分支的 `FailOpen` 分支不应再释放第二次。选择性过滤器尚未落地。

### 2026-09-30 续记 · 先取出节点列表再改会话

- 工程与测试：`refine_before_arm` 在调用 `heal::observe` 时同时可变借用 `inner.heal` 和不可变借用 `inner.nodes`，`app-rust` 编译失败。节点列表先收进局部 `Vec`，再改会话。探测顺序和放行条件没有变。
- 验证：本机仍不能跑 `cargo test`。推送后等该 head 的 `app-rust` 变绿。

### 2026-09-30 续记 · 变基到当前 main

- 来源：变基到 `origin/main` `ba7f07e4`。原先相对 `d2363002` 的四次提交保留。唯一冲突是 `docs/DECISIONS.md` 里两条 2026-09-30 记录的先后：main 上的崩溃放行（所有者）留在上面，本 PR 的粘性自愈记录留在下面。两条都保留。
- 缺陷修复：无行为变化。普通失败仍全量放回原网络；钩子就绪时仍是选择性 AI 保持、不调用显式全量释放；严格模式仍保持封锁。检查没有放宽。
- 剩余限制：合入顺序不变，仍先合 [#706](https://github.com/raydocs/tono/pull/706)。#704 相对当前 main 仍是可合并且干净，没有改它。

### 2026-09-30 续记 · 再次变基到 `939177f4`

- 来源：`main` 继续前移后，变基到 `origin/main` `939177f4`。没有把 main 合并进来。唯一冲突仍是 `docs/DECISIONS.md`：main 上较新的开机不重装、`pf.conf` 不在启动时加载规则，留在本 PR 的粘性自愈记录上面。记录都保留。
- 缺陷修复：无行为变化。助手协议版本与 main 同为 `4.52.2`，本 PR 没有改助手，因此没有再加 `0.0.1`。普通失败仍全量放回原网络；钩子就绪时仍不调用显式全量释放；严格模式仍保持封锁。检查没有放宽。
- 剩余限制：合入顺序仍是先 [#706](https://github.com/raydocs/tono/pull/706)，再本 PR。

### 2026-09-30 续记 · `core` 的 YAML 摘要钉在 #752

- 缺陷修复：head `41862ab2` 的 `core` 失败，因为整份 mihomo YAML 的摘要仍钉着 #732 拨号默认值之前的值 `5565d505…`，实际输出已是 `2a0e26f4…`。没有改断言，也没有放宽比较。变基到 `origin/main` `658aed21`，带上 [#752](https://github.com/raydocs/tono/pull/752) 的同一枚钉。
- 验证：本机 Cargo 1.83 仍不能跑 `tono-core`。推送后等该 head 的 `core` 变绿。
- 剩余限制：合入顺序仍是先 [#706](https://github.com/raydocs/tono/pull/706)，再本 PR。
