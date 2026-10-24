| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ANDROID-ALWAYS-ON-RESTART-SUPPRESSED | PR 内新增的停止标志吞掉同实例撤权/断开后的系统 Always-on 新意图 | in-PR | [#1742](https://github.com/raydocs/tono/pull/1742) | 高·已确认（Robolectric） | 撤销 explicitlyStopped；run40086755072 的真实 service 回归断言 RED，修复后 CI 待执行；需真实系统设置/lockdown 设备验证，不当作已发布版本缺陷 |

Claude 对 head `378c0c376` 的阻塞发现。原证据：`TonoVpnService.kt:411` 在 connect(false) 按旧标志无提示返回；onRevoke/disconnect 分别在 `:144/:513` 设置标志；SERVICE_INTERFACE 是更新的系统/用户意图，不能沿用这次拒绝。
修复删除标志及全部读写，保留已有 SERVICE_INTERFACE 启动语义。新增 `AlwaysOnResumeServiceTest.systemAlwaysOnRequestAfterRevokeAndDisconnectEntersPreparingInTheSameInstance` 穿过真实服务/引擎线程及持久化逻辑，不只是纯状态 helper。

真实 RED：282809586 / [run40086755072](https://github.com/raydocs/tono/actions/runs/40086755072)，期望 PREPARING，实际 NEEDS_PERMISSION；没有编译错误/跳过测试。
