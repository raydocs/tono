| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-WS-ID-IPC-U128 | Renderer WebSocket close cannot deserialize a numeric u128 handle and leaves the native reader alive | fixed(5e72e0ff) | [#834](https://github.com/raydocs/tono/pull/834) | 低·已确认 | P2 resource leak; real Windows IPC regression awaits CI; no network-policy change |

The plugin generates UUIDv7 IDs and returned them as numeric JSON, while the renderer stored JavaScript numbers. Tauri's command argument deserializer does not implement `deserialize_u128`; JavaScript also loses digits. Send decimal strings across IPC and parse back to the native ID before disconnecting. Ordinary page unmount now reaches native reader cancellation instead of swallowing argument rejection.
