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
