| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-DNS-ENABLE-LOCK-RETRY | macOS Helper 对 /dns/enable 的锁忙拒绝不重试，一次锁竞争就让连接失败并自动放行 | in-PR | [#1386](https://github.com/raydocs/tono/pull/1386) | 中·推导 | 最多 3 次、间隔 300 ms，锁被占更久仍会失败；锁竞争未实机复现；回归未在本机运行 |

Codex 核验 PARTIAL：锁失败返回 HTTP 400（不是 500），Connect 的 catch 走自动放行。REGLATE-MAC-DNS-LOCK（fixed b1df598c）只补了 restore。
