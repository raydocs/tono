# 2026-09-13 续修：G2 日志隔离与内部 CI

基线为集成分支普通合入 `main` `294b1449` 后的 `f02cdb53`。
本记录补充 [前次审计](RELEASE_READINESS_2026-09-13.md)，不代表客户发布批准。

## 已修复的行为

- 两端在记录进入异步写队列前绑定不透明的账户/授权 scope。只有验证过的当前账户才能激活 scope；同账户重启可续传自己的已标记日志。退出、换号、关闭再开启均使旧 scope 失效。
- **旧版无归属标记、未登录期间、其它账户或已撤销授权的记录只留本地，不自动补传。** 这不是删除本地诊断证据。新安装默认开启与已有关闭值保留不变。
- Windows catch-up 每段前后复核账户代际/授权。撤销会取消等待中的 HTTP future，旧回执不能推进 cursor；API 请求绑定读取账户时的身份 epoch，不能在调度间隙改用新账户 JWT。
- macOS HTTP 的 preflight/重试复用同一授权检查；cursor 写入与账户/授权切换串行化。手动上传不再重入周期 sweep，非 ready/睡眠/关闭时不能绕过前置条件。
- 两端在服务端已存但响应丢失时保留同一 `(session, sequence)` 的**完整压缩字节与消费范围**。不会用旧收据确认新增长的内容。
- Windows 改用已打开文件的身份判轮转，包含新文件已经长过旧 offset 的情形；先补匹配的 backup，再读 live。两端读取都以打开的文件句柄测量，避免 pathname 轮转竞态。
- Windows 偏好读改写加进程内互斥，避免另一个偏好写回撤销前的 scope。无法建立持久边界时不授予上传权，不放松连接保护。

局限：不能召回撤销之前服务端已经接收的在途请求。日志轮转仍有容量上限；重启或 cursor 丢失可能重新提交同账户记录，不宣称跨进程 exactly-once。

## 本地验证

| 检查 | 结果 |
|---|---|
| Windows App workspace `cargo +1.98.1 test --offline --locked --features clippy --lib` | App 471 / 471；该 workspace 其它 lib 目标也通过 |
| `tono-core` workspace `cargo +1.98.1 test --offline --locked -p tono-core` | 241 unit + 10 integration；认证专项 50 / 50 |
| macOS DiagnosticsLogOwnership / UploadRetry / UploadBoundary / UploadOutcome XCTest | 10 / 10，0 failure、0 skip |
| `git diff --check` | 通过 |

原始输出：`/tmp/tono-release-fixes-20260913/`。
macOS xcresult：`Test-Tono-2026.09.13_04-23-37--0600.xcresult`。
Windows 上 `FileIdInfo` / WFP 分支仍需 native CI 和真机；本地可移植测试不是实机证明。

## 仍阻止客户 release

1. G1：Windows 连接、仪表盘/Activity、断开 DNS 回收，以及 macOS 新 Helper 的真机验收未完成。
2. G2：日志服务端采集授权窗口的真实存储/读取未验；不移除 `stored:false` 授权门。
3. G3 / #26：更新准备的 Core/DNS 后置条件、受保护交接所有权仍有缺口；Windows/macOS 旧版升级实机未验。
4. hy2 的实时 roster 新增/撤销/空名单尚未同步到 HTTP 鉴权；Marina 仍不发布目录；自动切换保持关闭。
5. route-byte 失败累计区间与固定 22 分钟 windowStart 不一致；Servers 提示完成过早；DIRECT reload 暂时仍显示 Connected。这些尚未修复，不能混写为零 bug。

可以跑 CI 和构建**内部候选安装包**，但不升 0.0.73、不改 appcast、不推 windows-updates、不发布客户 release。
#137/#138 随 #147 集成，不单独重复合入；#26/#80 保持打开。
#65/#146 与 #148–#151 已在 main；新一轮 #152–#156 不因“依赖更新”直接放行，尤其 #153 的 Vitest/pool 兼容性仍需处理。

## 首轮 CI 纠正

`49e8b2bb` 的 Services CI 通过；macOS 全套 280 tests（1 skip）发现新增 busy 提示漏了中文翻译，已补 `Localizable.xcstrings`，不跳过本地化覆盖测试。对应本地账户/归属/本地化专项 **58 / 58** 通过。
同时把归属激活提前到身份验证成功、首次目录/运行时请求之前，避免最需要诊断的首次连接失败落成无归属记录；Windows App **471 / 471** 再次通过。
首个内部 Windows candidate 已主动取消，避免提供旧 SHA 安装包；新 SHA 重新跑 CI / candidate，仍不发布客户版本。
