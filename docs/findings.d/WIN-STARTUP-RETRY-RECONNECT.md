| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-STARTUP-RETRY-RECONNECT | A successful Windows startup-release retry deletes the crash tombstone and loses automatic reconnect intent | fixed(e70018ae) | [#986](https://github.com/raydocs/tono/pull/986) | 中·已确认（P2，Linux 回归） | Requires a crash release followed by a transient WFP removal failure. An app that sampled before retry completion can still need relaunch or manual Connect. Native networking needs hardware. |

The normal unwanted-intent startup path preserves crash reconnect intent. Its retry now does the same after successful filter removal, while still consuming explicit Disconnect tombstones and yielding to a newly armed/wanted session.
