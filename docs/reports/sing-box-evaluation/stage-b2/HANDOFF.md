# B2 交接：保留现有内核，继续前先验证与 AI 流式相关的差异

## 已运行并通过

- 四项 Go HTTPS/SSE 实测自测，四项 Python 离线编排/统计自测。
- 三候选 57/57 真 TUN smoke；三轮 1,602/1,602 AI 合成负载请求；18/18 启动后 HTTPS 验证。
- 负载/工具身份固定；隔离 namespace/进程/接口清理成功，host network 前后相等。
- 全部使用自有测试服务，总应用流量低于 256 MiB。没有大文件持续上传。

## 已运行但失败

只有**预期负向请求**：错误 CA/SNI/Reality 身份、503、截断 SSE、超时、core crash 后请求。
它们未被算成连接成功；对应 smoke gate PASS。正式性能批次没有 FAIL/TIMEOUT/缺失样本。

## 环境不支持 / 尚未执行

- netem 不支持，没有受控丢包/RTT/抖动，没有获授权国内测试端。
- 未测真实 AI provider、HTTP/2/3、token 粒度事件、长 SSE/工具调用/多模态/业务重试。
- 未做持续上传/下载或 Hy2 大下载 mixed 排名；按用户最新方向取消。
- 未启用 CPU/heap/mutex/block profiling；不声称无锁竞争。
- 未实现 1.2s fallback，未迁移/集成/发布，未替换任何产品 sidecar。

## 本地主线程与下一批最小范围

1. **Mac/Windows**：从真实点击到 protected dataplane 成功，验证 UI 阶段与 generation；
   PF/WFP+DNS、TCP↔Hy2 切换、cancel/retry/sleep/crash/reload 和更新交接按原生门禁执行。
   本报告的约 100ms harness startup 不可冒充真实连接时间。
2. 两项 P2 沿用 [已有源代码复核](../stage-b/AUDIT.md)，不另写产品补丁；
   [#171](https://github.com/raydocs/tono/issues/171) 的 final-replace/rollback 注入和
   [#26](https://github.com/raydocs/tono/issues/26) 安装包绑定验收由原生主线程完成。
3. 若继续实验，优先**小事件/较长 SSE 与独立 CPU profiling**，解释为何 C 的 SSE CPU
   高于 B；另加真实常用 HTTP/2 语义。保持正常测量和 profile 轮次分开，不扩大流量穷举。
4. Hy2 的产品价值是国内某些网络的备用可达性；需要获授权国内终端分别验证 TCP/UDP，
   不能从本地吞吐判断。无需生产账号/密码来继续准备实验。

**是否值得继续：值得聚焦验证，不足以升级。** JSON 突发显示潜在收益，SSE 显示 CPU
代价和相似的首事件体验；reload/DNS/pin/特权生命周期仍有 [PARITY_GAP](PARITY.md)。
不建议仅因峰值带宽换内核，不建议宣称某个 TUN 栈全面更优。

交付目录独立于 A/B；按用户后续“commit 上传 GitHub”授权推送实验分支，
不创建 PR、不合并、不打 tag、不部署。
