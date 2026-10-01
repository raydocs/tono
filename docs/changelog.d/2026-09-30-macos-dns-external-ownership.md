## 2026-09-30 · macOS DNS 快照归属检查
- 归属：SHIP_PLAN §2 第 10 条冻结期恢复故障修复；macOS helper DNS。
- 来源：基线 `b9c50b60` → 本分支提交待记；`fix/macos-dns-external-ownership-20260930`，未合 main，PR 待 root 协调 helper 版本。
- 缺陷修复：同一稳定 service ID 的 DNS 被用户/配置文件改为非 Tono 值后，restore 或服务切换不再用旧快照覆盖；先读 owner，仍是 Tono loopback 才恢复旧值；superseded 快照存档、restore 回报原值未恢复。读取或身份识别失败仍拒绝释放。见 [MAC-DNS-OWNED-SNAPSHOT](../findings.d/MAC-DNS-OWNED-SNAPSHOT.md)。
- 新增/优化：无。
- 工程与测试：`ProtectedDNSManager` 生产事务接缝新增 restore 与 handoff 各一项故障注入回归，挂入 helper `--self-test`。不运行本机 native 编译/自测。helper 版本和 `CONTRACT.sha256` 留给 root 集成，当前分支单独运行 macos-ci 的 helper 构建门预计失败。
- 验证：本地 `git diff --check` exit 0，`records.mjs findings --id MAC-DNS-OWNED-SNAPSHOT` 与 `records.mjs changelog --since 2026-09-30` exit 0；本 sandbox 无权写 worktree 的 `.git/index.lock`（位于可写根之外），故未提交、未推送、未 dispatch macos-ci；`gh auth status` 同时报告默认 token 无效。改前红测试与 helper 编译/自测未执行，不能声称通过；真实系统 DNS/PF/TUN 未测试。
- 候选/发布：仅源码，无新候选，无客户发布。
- 剩余限制：helper 版本 pin/合同尚未集成；BRICK-M12（未拥有服务的 `[127.0.0.1]` 清扫）与首装 loopback 快照行为未修；设备上 profile/网络并发写入未验证。

### Root 集成续记
- root 核对 assigned diff 后补齐 helper 4.52.0 和按 build manifest 顺序静态计算的 CONTRACT hash；静态 hash 不代表编译/自测通过。
- `originalDNSRestored:false` 也可能表示外部新 DNS 被保留，不再把 App/CLI 提示误写成服务被删除且已切 DHCP；同步真实 notice XCTest 和中文本地化。
- child 的 Git/gh 限制仅属于它的 sandbox；root 的 remote 凭据可用。root 负责提交、hosted CI 和独立高风险 diff 审查，未在本机编译或改系统网络。

### 2026-09-30 · 独立审查两项 major 续修（未提交交接）
- 复核 `3326b711` 后仅续修 helper DNS 与本条记录：带稳定 ID 的 SC DNS 读写失败不再退到同名服务；同 owner re-enable 若见外部新 DNS，先存档旧快照、持久化新快照，再写 Tono loopback；普通重试保留新快照。
- 工程与测试：helper `--self-test` 增加 ID I/O 失败和同 owner 新 DNS → re-enable → restore 两项生产接缝注入回归；未运行本机 native 编译/自测，root 负责精确源码 CI 和重新独立审查。
- 候选/发布：仅未提交源码，无新候选或发布；现有 4.52.0 pin 与合同未改。BRICK-M12 及设备并发 DNS 改动仍未验收。

### Hosted red 与首轮审查证据
- 旧行为仅加restore fixture的 `ae6f318b` [CI36685435186](https://github.com/raydocs/tono/actions/runs/36685435186) 实际在编译后helper `--self-test` 失败：`DNS superseded-restore regression FAILED: newer DNS was changed or reported restored`，build和privileged jobs均记录同一反例；没有将编译错误当产品red。
- 原修复准确 `3326b711` [CI36685038992](https://github.com/raydocs/tono/actions/runs/36685038992) 成功，但独立Codex high指出两项major，故未合：ID读写错误退回名字，以及same-owner enable仍留旧snapshot。原绿不是充分审查证据；本轮纠正新增实际dispatcher和同owner re-enable→restore/失败重试回归，必须新头CI和增量独立审查。

### 首次 enable 的未知身份也拒绝
- `7efd73e4` 独立Codex high增量复核确认先前两个ID-bearing majors纠正；但首次enable仍将SC ID lookup错误折成nil并创建名字快照，违反未知身份拒绝的边界。root只新增生产身份gate和一项nil/lookup失败回归：首次和再次enable均须正向识别serviceID后才读写DNS；既有legacy名字快照的restore支持不删除。
- 此项新回归尚未执行；不能沿用先前头为新准确头绿证据。最终CI及身份gate增量独立审查待完成。

### 2026-09-30 · 精确源码审查与合入 main
- 来源：[#690](https://github.com/raydocs/tono/pull/690) 最终 head `453ae24f9dfe80cb0c0d72cfa4305e3d8e067e69`，已合 main `a1e333e6b25d155dbf95d27147f915a7e3250894`。helper 4.52.0 manifest CONTRACT 静态摘要 `bb14859e4ed7363ca15d19011746fc18c58e51ae5f0862f2a552c53275f113d5`。上文待集成/待执行为当时状态，已由本段精确证据推进，不改写历史失败。
- 验证：最终准确头 [CI36688400051](https://github.com/raydocs/tono/actions/runs/36688400051) 的 sing-box-input、build（含 XCTest）、policy-tests、privileged-tests 全 success，helper 自测实际执行。root 查 GraphQL 无 review threads/CHANGES_REQUESTED、合入无新 source conflict、diff whitespace 通过。
- 独立审查：Codex gpt-6-sol/high 初审 `b9c50b60..3326b711` 两项 major；续审 `3326b711..a71c3602`（四处源码与 integration `7efd73e4` 相同）纠正两项但留下首次身份 major；最终 `7efd73e4..453ae24f` gate/hash 增量关闭该 major、无新 finding。notice/version/archive 未改范围沿用初审覆盖；[PR 记录](https://github.com/raydocs/tono/pull/690#issuecomment-5907437299)。CI 绿不替代源码审查。
- 候选/发布：仅源码；无新客户候选、未更新本机 Tono、未做本机 native/TUN/PF/DNS 操作、无客户发布。
- 剩余限制：BRICK-M12 外部 loopback 归属/首装快照、设备并发 profile/网络写入仍未闭环；不能把本修复当作已抹盘机器重启事故的根因或实机修复证明。紧急恢复 #691 另有三项 major，仍是 draft/no-go，不因本 PR 通过而放行。
