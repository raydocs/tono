| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SINGLETON-INHERITED-PROXY | An inherited HTTP proxy intercepts the authenticated localhost notification, so a second launch cannot reopen the existing window | fixed(c8ad24e9) | [#984](https://github.com/raydocs/tono/pull/984) | 低·已确认 | P3; isolated-process regression failed before and passed after; native Tauri/Windows tests await CI |

`utils/server.rs:100` used reqwest's default system/environment proxy handling for the singleton's `127.0.0.1` request. A launching shell with HTTP_PROXY or ALL_PROXY and no loopback exclusion sends the request to that proxy instead of the primary instance. `check_singleton` retries for 20 seconds, then the secondary process displays startup failure and exits. The existing app and its connection remain healthy.

The notification client now disables proxies explicitly. Authentication, loopback binding, the singleton lock and deadlines are unchanged. A subprocess test sets proxy variables only in the child, calls the actual notifier and verifies the intended local endpoint receives the authenticated visible command.
