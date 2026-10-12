| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-RELEASE-STATUS-REPORT-EXPOSURE | `/release/status` 新增的 `ReleaseStatus.report` 把发布工作线程的最近报告原样返回：没有大小上限、没有脱敏（原始错误、网卡 GUID、路径、残留写者 PID），是整机范围而不是按请求者划分，并且可能属于更早的代号 | open | [#1590](https://github.com/raydocs/tono/pull/1590) | 低·推导 | UI 跟进：App 展示前必须按请求 ID / 代号核对这份报告属于自己的那次释放，并先裁剪；该接口本身只对已认证的所有者开放 |

报告在 `release/daemon.rs` 的 `status()` 里按 `answer` 的口径取自当前或最近一次 run。25 秒首次答复之后的最终结果和「清理超出 45 秒预算」的备注只在这里可见，所以才暴露它；
App 现有的状态轮询只读 `mode`/`generation`/`running`，目前没有任何界面展示它。展示前要做的事：核对 `request_id`/`generation`、限制长度、去掉路径和 GUID 之类的细节。
