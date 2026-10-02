| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| REGLATE-MAC-DNS-LOCK | The second, snapshotless DNS restore before every Kill Switch release takes the network-preferences lock since #1144; one lost lock race failed it and the release was never sent, leaving a non-strict Mac blocked | in-PR | #1239 / #1328 | 中·推导（P2，源码与回归） | Lock race not reproduced on hardware (needs-hardware); a writer holding the lock longer than about 0.6 s still blocks until the next attempt |

RegLate macOS regression pass (main `b9ab47db`). The helper refuses rather than waits for the lock and its comment leaves the retry to
the caller; the App had none. Fixed in the App (`HelperManager.retryingHelperRefusal` around `/dns/restore`), so the helper and its
version are unchanged and the first, snapshot restore gets the same retry. Regression: `HelperRefusalRetryTests`.
