## 2026-09-30 · 开通脚本按 git 根拒绝仓库内私钥路径
- 归属：ops 计划（节点开通），不是 SHIP_PLAN 发版门。影响 `tooling/scripts/provision-tono-node.py`。
- 来源：基线 `origin/main` → 本分支。未合 main。
- 缺陷修复：`REPO` 取的是 `parents[1]`（`tooling/`）。错误文案要求路径在仓库外，但 `services/` 或 `apps/` 下 mode 0700 的目录能通过。改为 `parents[2]`（git 根）。
- 新增/优化：无。
- 工程与测试：`Contracts.test_acl_probe_fail_closed_and_repo_rejected` 增加仓库内 `services/provision-secret.json` 必须报 outside the repository。修复前失败信息是 path must be owner-only，修复后整文件 20 tests OK。
- 验证：`python3 tooling/scripts/tests/test_provision_tono_node.py`，20 tests OK。
- 候选/发布：仅源码，无新候选。未对真实节点执行开通。
- 剩余限制：操作者仍须自己把清单放在仓库外；本修复只让那条检查覆盖整个 git 根。
