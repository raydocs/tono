| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DEBOUNCE-DROPS-EVENT | 健康监视把防抖窗口里的下一次网络或 Core 变化直接记成已处理，事件丢失而不是延后 | fixed(5b0f39db) | #878 | 中·已确认 | 窗口仍是 2 秒。第一次变化照旧立即处理。needs-hardware |

`network_event_fires` 在窗口内返回 false，但监视器仍把 `network_events_counter` 和 Core 基线写成新样本。下一拍不再看到差异。H5 已说明计数前进会使事件丢失而不是延后。回归：`a_debounced_sample_stays_visible_until_the_window_elapses`。
