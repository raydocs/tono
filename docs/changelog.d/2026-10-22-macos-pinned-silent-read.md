## 2026-10-22 · macOS pinned 控制面读请求首包期限
- 归属：SHIP_PLAN §2 item 10 / MAC-CP-PINNED-SILENT-WAIT；macOS 控制面 transport，独立 draft PR，不推进发布门。
- 来源：基线 `d1232520a742b3e747f7b9a228361d696f24a172`；分支 `t3/macos-control-plane-pinned-wait`，尚未合 main。
- 缺陷修复：TLS 建连后不发 HTTP 首包的 pinned 地址原占满 45 秒 exchange wait；现在仅 GET 且后面还有路径时，复用 15 秒首包预算，关闭旧连接后才返回超时交给原路径回退。期限在全部 pinned 地址间共享，不逐地址重置；不延长已有连接/完整交换预算。
- 新增/优化：无。已收到最终状态行的慢 headers/body 保留原等待与会话判定；登录/变更 POST 不使用首包期限、不增加重放；TLS 主机验证、允许集、PF、中继连接竞速均未放松。
- 工程与测试：注入原 transport 的 I/O、单调时钟与定时器，fixture TLS-ready 后挂起响应、手动推进时间；每个行为一条窄 XCTest（静默、慢 body、共享期限、取消隔离、POST）。不使用 wall-clock race。
- 验证：旧行为加注入 seam 的 `daad6b73f6a4b1307be3bcfe5ad66bce8c24c5b4` 在 hosted macos-26 [run 39866752599](https://github.com/raydocs/tono/actions/runs/39866752599) 实际 RED：`testASilentPinnedReadClosesItsRequestAtTheHeadBudget`，关闭次数 `0 != 1`；753 tests / 1 skipped / 3 failures，3 个断言全属于该回归。修复后 hosted 检查以本 PR 的 exact-SHA 验证回执为准。`git diff --check` 无输出。
- 候选/发布：仅源码，无新发布候选、部署或网络/凭证操作。
- 剩余限制：路由/并发生命周期高风险，须父线程独立审查；本机原生测试禁止且未执行，实机/真实服务/中国网络未测。末路径和 POST 仍保留原完整交换等待。上游 ops 文档旧时间界限不作为新证据。
