| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DNS-CALLBACK-LIFETIME | Windows system-DNS callback can access freed completion storage after the waiting worker consumes its outcome during a deadline/spurious wake | fixed(624066fc) | [#828](https://github.com/raydocs/tono/pull/828) | 中·已确认（P2；极短并发窗口） | Deterministic ownership regression passes locally; Windows DNSAPI/app CI and real-device timing remain |

Main `windows_dns.rs:149-151` unlocks the published outcome before its final condition-variable access. `query_a_blocking` can observe the outcome after a deadline wake and return, destroying the stack-owned completion. A separate callback-owned `Arc` now keeps it alive through notification and mutex teardown; the synchronous path consumes its unused reference because DNSAPI never invokes a callback for non-pending results.
