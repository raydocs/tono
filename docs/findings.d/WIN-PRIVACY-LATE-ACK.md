| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-PRIVACY-LATE-ACK | 设置页的隐私保存锁只属于组件，卸载后的迟到回执可覆盖后继页面已保存的选择，导致上传实际开启却显示关闭和已保存 | in-PR | [#1546](https://github.com/raydocs/tono/pull/1546) | 高·推导（Sol major，模拟原生 IO/回执延迟回归） | 发现于未合入的初版；保存锁/失败结果已跨页面共享，新增导航回归先失败后通过；新 head 独立复核和 CI 待记。非真机泄露证明，真实 Windows IPC 延迟与上传取消行为仍待设备验证；native setter/default/helper/PF/WFP 未改 |

独立 Sol 初审只覆盖 [ff95a34dd](https://github.com/raydocs/tono/commit/ff95a34dd365737e779f271f0abec6601123e88a)，该 head 不可合入；覆盖与定点续修证据记录在 PR 评论。源码修复进入 main 前保持 `in-PR`。
