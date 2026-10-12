## 2026-10-10 · Orb 按需依赖：修复 kode-bridge 独立锁文件
- 归属：运维计划 §2.6 构建验证；续接公共 setup PR [#1544](https://github.com/raydocs/tono/pull/1544)，不改变客户发布门。
- 来源：合并基线 [230e32cf](https://github.com/raydocs/tono/commit/230e32cf0ceffed3168d7df5d5f2102ff4eba7a8)；分支 `amp/orb-kode-locked-setup`，本 PR。
- 缺陷修复：Dependabot [b9555387](https://github.com/raydocs/tono/commit/b955538739e5234eba57486a54d79048803c6633) 把 vendored kode-bridge 的 `toml` 要求改为 `1.1`，未更新它的独立锁文件（仍为 `0.9.12`）；`cargo fetch --offline --locked` 也拒绝，非网络问题。仅同步 TOML 依赖族，保留其它 crate、App/Service/Core 锁文件与清单不变。源码未改。
- 新增/优化：可执行 `.agents/setup-task {kode-bridge|windows-rust|icon-design}`，显式按任务安装固定工具链/依赖；Rust 使用 app 的 1.98.1 pin 和 `cargo fetch --locked`，不编译、不测试、不改默认 toolchain。公共 setup/resume 不调用此入口，保留缓存。
- 工程与测试：Windows CI 增加独立 kode-bridge 锁文件 fetch 回归；App/Service 的 path dependency 验证无法覆盖该独立锁文件。运行/主机边界已记入 BUILD_AND_TEST。
- 验证：Linux x64 当前 orb，任务首次 `windows-rust elapsed=11.63 user=9.65 sys=2.15 exit=0`（含安装 1.98.1 与下载缺失 crate），四份锁文件均通过；`kode-bridge` 暖执行 `elapsed=0.14 user=0.08 sys=0.05 exit=0`；icon-design `elapsed=0.50 exit=0`，实际导入 `Pillow 12.3.0`。所有任务前后锁文件 SHA-256 及默认 toolchain 一致。脚本 `bash -n` 通过。公共 setup 复验 `elapsed=5.69 exit=0`。
- 耗时对照：旧公共暖运行 `12.50s / exit101`；#1544 新首次 `25.51s / exit0`（补装 ops-console）、新暖运行 `4.46s / exit0`；本次公共暖复验 `5.69s / exit0`。均不是新 orb 冷启动。原始脚本保留在基线 Git 历史，可撤销本 PR 与 #1544 回滚；旧失败也随之恢复。
- 候选/发布：仅开发环境与独立锁文件，无客户包、部署或客户更新源变化。
- 剩余限制：冷启动、精确快照命中与刷新仍待后续正常启动 orb 验证。本次只读快照列表：a1.medium 更新于 `2026-10-10T17:45:02.405Z`，a1.large 更新于 `2026-09-21T22:51:33.086Z`，列表不提供源码身份，不能据此宣称命中。项目外脚本为空且未改；无删除快照、规格/模型调整。原生编译证据只以本 PR 精确 head 的 CI 为准。
