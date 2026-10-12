## 2026-10-10 · API 中继日志轮转（A7）
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)，backlog [A7](../ops/amp-backlog-2026-10-10.md)；中继节点（Westwood、Mesa）nginx 日志；不是 ship gate。
- 来源：基线 main `3e6aebd2` → 分支 `amp/a7-relay-logrotate`；PR 见分支；未合 main。
- 缺陷修复：无。
- 新增/优化：规范副本 `tooling/ops/relay/tono-relay.logrotate`，由 `apply-relay.sh` 安装为
  `/etc/logrotate.d/00-tono-relay`（0644）：`tono-relay.log` 与 `tono-relay-error.log` 按天轮转、保留 14 份，
  `dateext`、`compress`、`delaycompress`、`missingok`、`notifempty`，`postrotate` 用 `invoke-rc.d nginx rotate`（与发行版
  nginx 包相同）。发行版 `/etc/logrotate.d/nginx` 的 `/var/log/nginx/*.log` 也匹配这两个文件，同一文件两处声明时
  logrotate 报 `duplicate log entry`；`00-` 前缀让 Tono 段先读，`ignoreduplicates` 让后面的发行版 glob 跳过这两个文件，
  不改发行版 conffile。`ignoreduplicates` 需 logrotate 3.21+；更旧版本（Ubuntu 22.04）脚本跳过安装并提示，发行版段仍
  按天 14 份轮转（无 dateext）。安装后跑 `logrotate -d`，报本文件错误或重复条目则删回。新增 `--logrotate-only`：只装
  轮转，不碰 nginx。`docs/ops/api-relay.md` 写明安装、检查与撤销。
- 工程与测试修正：`apply-relay.sh` 源目录与 logrotate 路径可由环境变量覆盖（默认不变：`/root`、`/etc/logrotate.d`）；
  一个回归 `tooling/scripts/tests/test-apply-relay-logrotate.sh`（`--logrotate-only` 安装到正确路径、0644、内容与规范
  副本一致，且不调用 nginx/systemctl/apt-get）。
- 验证：本机 Linux `sh tooling/scripts/tests/test-apply-relay-logrotate.sh` → `ok`；`bash -n apply-relay.sh` 通过；
  临时桩另验 3.19 跳过、`-d` 报重复时删回并退出 1、无 logrotate 时跳过。未执行：`logrotate -d`（本机未装 logrotate，按任务不安装）；
  节点安装（orb 无 SSH）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：节点安装待做（node install pending, no SSH from orb）：按 `docs/ops/api-relay.md` scp 三个文件后
  `bash /root/apply-relay.sh --logrotate-only`；节点 logrotate 版本未核实。安装前发行版已轮转出的编号文件不被新段清理，需手删一次。
