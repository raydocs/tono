| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| T4-REACHABILITY-TOKEN | 套件路径只要是更长词元的子串，注册检查就把它当成已经接线 | in-PR | [#953](https://github.com/raydocs/tono/pull/953) | 低·已确认 | 与 T4-REACHABILITY-SIGPIPE 不同。当前 workflow 里没有这样的假引用。`*.test.mjs` 通配符仍不算逐文件引用 |

`grep -F` 把 `tooling/scripts/test-wired.sh.skip` 当成 `tooling/scripts/test-wired.sh` 已运行。检查退出 0。`../../tooling/scripts/test-wired.sh` 这种真实前缀仍然算接线。
