# 0.0.75 发布门槛 G1 / G2：老板真机验收最短步骤（2026-10-10）

规则：SHIP_PLAN §6 的 G1、G2 只能由老板本人勾选，并附证据链接；代理不改这两行。证据必须对应**同一个冻结候选**
（源码 SHA + 包哈希）。候选一旦改变，旧证据不能复用（[RELEASE_LINES「Candidate identity」](../RELEASE_LINES.md)）。

## 候选包状态
- **0.0.75 最终候选尚未构建。** 顺序（用户 2026-10-10 确认）：先完成两端有限 UIUX 收口，再一次性冻结最终组合 →
  组合验收线程核对准确 SHA → `release/macos`、`release/windows` 快进到该 SHA → `macos-release.yml`、`windows-release.yml`
  （同一个 `update_release_sequence`）→ 把 run 链接、源码 SHA、每个安装包的 SHA-256 补进本文件。
- 旧候选（e9967812，序列 7505，10-08）**不是**本次组合，不能用来勾 G1/G2。

## G1（Windows + macOS 基本连接可信）
1. **Windows 候选哈希 + Connected 稳定**：安装冻结候选 → 记录安装包 SHA-256（与上面列出的一致）→ 登录 → 连接一个默认城市 →
   等 5 分钟，仪表盘与 Activity 一直是 Connected，不回到 retry。证据：哈希截图 + 5 分钟后的仪表盘/Activity 截图。
2. **断开收回 DNS 与保护、再连成功**（Win + Mac 各一次）：连接后点断开 → `nslookup example.com`（Win）/
   `scutil --dns | head`（Mac）显示系统原 DNS，不是 127.0.0.1；浏览器能直连 → 再点连接成功。证据：两张命令输出截图 + 再连截图。
3. **#116 / #117 可复述**（Windows）：连接中重启一次 “Tono” 后台服务（服务管理器里 Restart）→ 会话不掉（#116）；
   之后断开再连正常，不残留 “unreadable run”（#117）。证据：前后截图或诊断导出。
4. **macOS 连接/断开回归**：Mac 上连接 → 断开 → 再连接 → 睡眠 1 分钟唤醒 → 仍 Connected 或自动恢复；
   断开后网络正常。证据：截图 + 一份诊断导出。

## G2（连不上时有下一手）
1. **B0 日志默认口径写进发布说明**：已写（apps/windows/release-notes/0.0.75.md、apps/macos/release-notes/build75.md）。
   你只需读一遍确认措辞即可勾。
2. **Windows 与 macOS 失败都在客户时间线**：代码已合（Windows #1494、macOS #1513），但**需要先部署控制面**
   （迁移 0096/0097/0099/0100 先在 preview 演练：`tooling/scripts/rehearse-control-plane-migrations.sh` 打印命令；
   然后在你的 tono 账号机器上 `npm run deploy`）。部署后：在 Win、Mac 上各制造一次连接失败（例如断网时点连接），
   打开 ops 控制台该客户时间线，看到两台设备的失败行（含「换路径」行）。证据：时间线截图。
3. **[`docs/ops/transport-hy2.md`](transport-hy2.md) 有三网结论**：当前只有海外测量平台的国内探测点数据（UDP 可达性，非 hy2 握手）。
   需要：在国内电信/联通/移动家宽各跑一次 `tooling/ops/cn-acceptance`（或 `tooling/ops/hy2/hy2_probe.py`，需测试账号凭据文件），
   把结论写进该文档。证据：工具输出 JSON。
4. **自动切换**：走「降级」分支即可——发布说明已写「本版备用通道仅手动」，你只需在一台设备上**手动**选一次 Backup channel
   （hy2）能连上。证据：截图。（自动切换代码已合但由控制面开关控制，客户默认关，不需要本项验证。）

## 本组合**不包含**、但 main 上仍存在的已知风险（排除不等于风险消失）
- macOS `--emergency-disarm` 仍可能与在线 daemon 双写；应急路径存在无上限等待（MAC-EMERGENCY-UNBOUNDED-WAITS，高）。A13 #1504 Sol FAIL（3 major），未合。
- macOS 连接中仍放行局域网私网（D7）。A29 #1506 在修 Sol 的 3 个 major，未合。
- macOS 连接中开始原生更新、Execute 失败后，armed 状态下没有控制面放行，断开即可恢复（[MAC-UPDATE-RETAIN-NO-RELAY](../findings.d/MAC-UPDATE-RETAIN-NO-RELAY.md)）。
- macOS 自动解除保护本身失败时停在 Protected Offline、不自动重试（MAC-AUTO-RELEASE-FAIL-NO-RETRY，fail-closed，无泄漏）。
- hy2 自动切换（仅内部账号开关打开时）有已记录的次要问题（A17W-*）。
- 第三台中继 38.14.195.144 入站 2053 被供应商挡住（#1538 草稿）；两台 DMIT 洛杉矶中继同属一个供应商，有一起失效的风险。
- D1 定时备份仍缺 Cloudflare secret（D16）。
- 已在 main（随候选带上，但仍需实机）：A30 macOS 无隧道 armed 只经中继（#1507）、Windows W-A 中继放行（#1539）、
  Windows 更新断点续传与半截文件清理/取消（#1527、#1540）。
