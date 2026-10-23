## 2026-10-23 · Android 控制面禁止重放可能已送达的 POST
- 归属：SHIP_PLAN §2 item 10；Android mobile 控制面认证请求路径。
- 来源：基线 `8a3ba2cc7db6a305aa96a3ef65646c951a7b474c`，分支 `t3/android-post-replay`；
  RED-source `d82e81cd99b0376663f3d9d62922a24e0be8c607`，后续 FIX 提交；未开 PR、未合 main。
- 缺陷修复：首次 HTTP 写入前标记可能已发送，阻止写入、读取、截断响应、无结构化 5xx 后的 POST
  自动换路径重发；关联 `ANDROID-POST-AMBIGUOUS-REPLAY`。connect/TLS 包装异常也会关闭自有 raw socket。
- 新增/优化：无；保留 GET 回退、POST 写前 DNS/connect/TLS 握手回退、结构化 API error、
  TLS SNI/hostname 验证、认证 header、本地明文门、既有超时和中继配置；不新增幂等键或服务端变更。
- 工程与测试：新增内部 connected-socket seam；一个确定性、无网络顺序回归实际执行生产 HTTP framing/retry，
  记录写入和路径尝试，不 mock 整次 exchange。RED 与 FIX 使用同一份测试源码；不改非网络 CI fixture 或工作流。
- 验证：MacBook 仅做 `git diff --check`、RED-source 重试循环/基线及测试源码身份的静态检查。
  未执行 RED/GREEN JUnit、Gradle 编译/lint、Android 模拟器/真机或独立高风险审查；由父任务在 Devin 同 VM 执行准确 refs。
- 候选/发布：仅源码，无新候选，无部署/发布。
- 剩余限制：未声称运行时 RED/GREEN 或设备验收；修复及测试均待云端编译与执行，父任务独立审查后才决定后续。

- 父任务集成与运行：独立分支 `fix/android-post-replay-safety-20261023`，产品与 worker FIX 字节相同。
  云端 RED `d82e81cd9` 一个回归断言失败；GREEN `b97d55c28` 同一回归 1 passed，routing18passed、
  mobile103passed/25默认skipped、lint通过。Sol/xhigh 精确 diff 审查无 finding；只追加本证据文档。
  所有测试在 Devin，未运行本地 native 构建；未部署/发布，实际 TLS/手机资格未完成。
