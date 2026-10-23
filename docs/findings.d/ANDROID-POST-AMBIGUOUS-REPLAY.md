| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ANDROID-POST-AMBIGUOUS-REPLAY | Android 控制面在 POST 可能已送达后仍自动换路径重发，可能重复消耗验证码或轮转 refresh token | open | 待开 | 中·推导（源码） | 本分支已修源码；RED/GREEN 待 Devin 在同 VM 执行准确提交，独立审查、真机、合 main 与发布均未完成 |

- 归属：SHIP_PLAN §2 item 10；Android 产品审计，基线 `8a3ba2cc7db6a305aa96a3ef65646c951a7b474c`。
- 原路径链对任意 `IOException` 和无结构化 API error 的 5xx 都回退；读取响应失败不能证明
  验证码未被消费或 refresh token 未被轮转，首次 write 抛错也可能已经发出部分请求。
- 修复在首次 HTTP write **之前**标记可能已发送；此后的 POST IO 失败和无结构化 5xx
  不再换路径，仍以外层 `ApiException(0, "NETWORK", ...)` 结束。
  DNS、TCP connect、TLS 握手及取 output stream 的写前失败仍可换路径；GET 与结构化 API error 语义不变。
- TLS 每条真实路径仍按 API hostname 设置 SNI、HTTPS endpoint identification 并验证 hostname；
  bearer/header、debug-only 本地明文门、路径顺序、中继地址及超时不变。原始 socket 用 `use`
  覆盖 connect/TLS 包装前的异常清理，不增加幂等键，不改服务端。
- 一个顺序 JUnit 回归经真实 `call → exchange → send → readResponse` 执行 framing/retry；
  仅在连接后 socket IO 边界注入内存 fixture，记录尝试与实际写入。包含写前/GET 对照、
  部分首次写入、模拟读写超时、EOF、截断响应、无结构化 5xx 与结构化错误；无睡眠、生产请求或整次 exchange mock。
- RED-source `d82e81cd99b0376663f3d9d62922a24e0be8c607` 仅增加 seam 与测试，重试循环与基线逐字节相同；
  本机未运行 Gradle/JUnit，不把源码检查称作失败或通过的运行证据。
