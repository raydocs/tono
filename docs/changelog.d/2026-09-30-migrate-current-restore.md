## 2026-09-30 · 节点布局迁移在链接失败时恢复 current
- 归属：ops 计划（节点迁移），不是 SHIP_PLAN 发版门。影响 `tooling/scripts/remote/migrate-node-to-release-layout.sh`。
- 来源：基线 `origin/main` → 本分支。未合 main。
- 缺陷修复：`mv current` 到备份之后，`ln -s` 或 `mv -T` 失败会在 `set -e` 下直接退出，`/opt/tono-xray/current` 消失，该出口直到人工恢复都没有二进制。现在这两步失败会把原目录移回去再退出。
- 新增/优化：无。后面 `systemctl restart` 失败仍走原来的 `restore`。
- 工程与测试：`tooling/scripts/tests/migrate_node_layout_test.py`。修复前 current 不是目录（链接报 File exists），修复后 1 test OK，`sh -n` 通过。
- 验证：上述命令在 Linux 上通过。未在真实出口执行迁移。
- 候选/发布：仅源码，无新候选。
- 剩余限制：备份目录自己移不回去（磁盘故障）时仍可能缺 current。未覆盖重启后端口未监听的原路径。
