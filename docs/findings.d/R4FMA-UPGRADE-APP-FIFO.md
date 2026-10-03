| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4FMA-UPGRADE-APP-FIFO | App-side silent-upgrade path validation blocks on an in-bundle FIFO before signature validation | fixed(1458a9de) | [#1162](https://github.com/raydocs/tono/issues/1162) | 中·已确认 | P2: malformed/tampered local bundle prerequisite. POSIX extracted before/after fixture verified; Swift/macOS CI and installed recovery not run locally. |

Baseline `fafa1bc0`: `HelperManager.swift:1216–1217` validates source paths before signature admission at `:1218`; confinement accepts an in-bundle FIFO and `:1543` performs a blocking read-only open without regular-file proof. Core was stopped by upgrade preflight, and the synchronous call cannot reach deferred recovery while waiting. This is the app-side sibling of helper-only #928/#979.

Open with `O_NONBLOCK`, inspect the opened descriptor with `fstat`, require `S_IFREG`, and close on every exit. Existing confinement/signature admission stays intact. One bounded XCTest supplies a cleanup writer only when validation failed to return, so the baseline and a missing-nonblocking regression fail without parking CI. No helper IPC/network contract change or candidate.
