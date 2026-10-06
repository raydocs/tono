## 2026-10-06 · Windows 发布测量必须绑定 sing-box
- 归属：SHIP_PLAN G4.1 发布准备；Windows 更新工具与候选 provenance；续修 #1320、#1321。
- 来源：main `9b5cf144` → 本 PR；分支 `raydocs/release-0075-closeout-20261006`；仅源码，尚未合 main。
- 缺陷修复：无新增客户运行时修复；这是既有 R6 发布信任/工程问题的修正。
- 新增/优化：Windows payload selector 必须找到安装位置的 sing-box，所有同名副本必须相同；测量必须读取实际 sing-box 字节；新组装的 Windows target 必须有摘要。历史已签 manifest 的读取/验签保持兼容，macOS 不新增必选项。
- 工程与测试：候选 manifest 记录 sing-box sidecar 摘要；unsigned candidate 与签名流程都显式传入必选 sing-box，并检查 selector 输出。
- 验证：MacBook Node 本地 22 tests / 22 pass / 0 fail（两个测量测试文件与 Windows workflow 合同测试）；YAML 解析使用 coral 已安装的 js-yaml，未安装或改锁文件。修前行为实跑：四条 Node 回归失败（缺少组件、不同副本、缺少测量输入、缺少组装摘要），provenance 回归另有一失败；实现恢复后全部通过。`git diff --check` 无输出。
- 候选/发布：无新包、无签名、未修改客户更新源；原生构建及真正安装包 provenance 由后续 hosted 候选流程验证。
- 剩余限制：独立 release-trust 审查与精确 head 的 ci-gate 尚待；不代替 G1/G2/G3 真机验收。
