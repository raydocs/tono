| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| I-UI0075-POLISH-A-3173-O-F2 | 暂停后相位更新排入冻结时钟并在恢复可见时重播 | in-PR | [#1426](https://github.com/raydocs/tono/pull/1426) | 低·已确认 | 隐藏或非活动页面收到相位更新时直接应用最新值并清除阶段过渡，环境循环时钟仍暂停；实际无残留 transition key XCTest 待 CI。 尚待最终 head 增量生命周期复审，不凭源码关闭。 |

- 来源：jev-route `3173f320` 对 `82b91e635` 的 opus:F2，PR 原始评审记录；一轮修复，不是 owner 真机验收。
