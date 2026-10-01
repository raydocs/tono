## 2026-09-30 · E2/T2 六项修复均通过 CI 合入 main

- 归属：SHIP_PLAN §2 item 10；E2/T2 独立审查交付状态。
- 来源：`origin/main` `92260464b49609d0132e65824612c47ab4eab1e3` → `hunt/sol-r3ops-final-delivery`。六个源码 PR #995/#996/#997/#998/#1000/#1002 均以 merge commit 合入，确切 main SHA 与 gate 链接见各原 changelog 的续记。
- 缺陷修复：无新增源码修复；更新四个节点 findings 分片的 fixed SHA/PR 链接，以及完整报告的最终交付状态。原失败/通过证据保留。
- 新增/优化：无。47 个假设仍为 7 个确认（6 个修复、1 个决策项）、33 个驳回、7 个重复。AI 路由、strict kill switch 与 TLS 验证未放宽。
- 工程与测试：本次只改记录。为检查分支合并后的相互影响，在上述完整 main SHA 执行 Linux fixture：remote node 5/5、provisioner Flow 8/8、connect-bench check 7/7、CI path-filter 7/7，全通过，无跳过。未再次运行已知缺 system SSH 的整套本地 provisioner 测试。
- 验证：原 #995 hosted Ruby 为 12 tests / 141 assertions / 0 failures / 0 errors / 0 skips；六个源码 PR 的所需 CI 均通过。Ruby、Xcode 和真实 VPS/systemd 网络验收未在本 VM 执行。`git diff --check` 与 records 分片读取通过。
- 候选/发布：仅源码与交付记录；本 hunter 未操作真实主机、部署、发布或生成客户候选。Hosted CI native builds 不作为真实设备或客户候选验收。
- 剩余限制：#995/#996/#997 保留 needs-hardware，待统一实际拨号/节点 restart/rollback 验收；HOME-AGENT-PEER-RETENTION-CAP 保持 open，安全清理需要计数连续性语义，reporter 未部署。Benchmark sample-phase resource exhaustion 未证明为普通可达缺陷。
