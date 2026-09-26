## 2026-09-26 · 批次部署与合并后回归审查（#634–#639、#514）

- **归属/来源**：ops（部署与记录），按 AGENTS.md「合并批次后做合并回归审查、记录部署」；无新代码。
- **部署**：
  - 控制面与 admin Worker 从 main@57c1c64c（含 #638 的 `revoked_token_hash`，列已由 0081 迁移存在）经
    `tooling/scripts/deploy-control-plane-main.sh` 部署；脚本内 typecheck、`npm test`、策略签名合约检查全过，D1 迁移无新增。
    admin Worker 版本 `48a01855-7d84-4d0a-9e87-a12070f3a101`。本次部署前**未导出 D1**（当时 AGENTS.md 尚无该条，#514 合入后生效）。
  - exit-agent：13 个装有 agent 的节点 `reconcile_and_report.py` 由 aecb4cec 换为 main 版本（md5 b50edcbe…），逐台备份到
    `/root/tono-exit-agent-backup-20260926/`，替换后首轮 `result=success`；Tokyo·Sakura（148.135.183.152）SSH 超时未部署；
    其余 7 台主机未装 agent。
- **合并回归审查**：区间 `f2e24512...fb5e8485`（#634、#636、#638、#637、#635、#514、#639），jev-route 双厂商
  （opus + codex）run `4459fadd`，PASSED，无 major；确认的 minor 另行跟进：helper `-E` 超时找回按 PID 认领可能误收他人 token、
  记录写失败回退吞掉 `-X` 超时（#601 续修）；Windows 登录提交时标记写失败（#409 续修）；exit-agent 空名册提前返回丢计数（#600 续修）；
  记录状态滞后（本条目同步）。
- **记录同步**：H19-O-F2-R1、R609-F2、TF-opus-3/5/6、H1-F2 改为 fixed（合入 SHA）；TF-opus-7 改 open（两种损坏状态文件情形仍无回归）；
  H11-F2 改 open（Windows 半边 #632/#635 已合，macOS data-protection keychain 未做）。
- **候选/发布**：内部候选从 fb5e8485 构建中（macOS run 36212061109、Windows run 36212062220），未发布到客户通道。
- **剩余限制**：各修复的设备验收待候选包实机测试。
- 续记 2026-09-26（按条目模板补齐）：
  - 来源：合并批次 #634、#636、#638、#637、#635、#514、#639（main fb5e8485），随后 #640（42e3afd6）、#641（50c2c0d0）。
  - 部署：exit-agent 第二轮换为 main@50c2c0d0（#641，md5 ffe030b1…），13/13 `result=success`，备份 `/root/tono-exit-agent-backup-20260926b/`；
    Tokyo·Sakura 仍未部署。控制面此后无新部署。
  - 验证：合并回归审查 run `4459fadd` 覆盖到 fb5e8485；#640、#641 各自双厂商审查，未单独做批次回归审查（下一批一并覆盖 fb5e8485 之后的提交）。
  - 候选/发布：内部候选 0.0.73 build73 源码 fb5e8485 已构建并与包内 manifest 核对——Windows `Tono_0.0.73_x64-setup.exe`
    25,411,125 B，SHA-256 `fb24f1272425543bedbd0d9b8452d104c83e31135519cf42b146228c717166f5`，未签名；macOS
    `Tono-0.0.73-build73-arm64.zip` 19,704,496 B，SHA-256 `aa03769e52c6ab600fa8666ed065e45a156f1b39fcb6258dd8c74da07657aa1f`，
    Developer ID 签名并已公证。仅内部测试，未发布到客户通道。
  - 剩余限制：候选实机验收（所有者合并测试轮）未做；#642、#643 不在此候选内。
