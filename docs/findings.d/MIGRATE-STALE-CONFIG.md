| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MIGRATE-STALE-CONFIG | 发布布局迁移在 xray 测试期间如果 hub 改写了 config.json，切换后的 current 仍是测试前的旧配置 | fixed(309d97ed) | [#913](https://github.com/raydocs/tono/pull/913) | 中·推导 | 测试通过后到 mv 之间仍有极短窗口。配置一直在变时脚本失败并留下原来的目录。与 #845 的符号链接失败恢复是不同缺口。未在节点上跑。 |

拷贝发生在 `xray run -test` 之前。测试期间 hub 写进 `current/config.json` 的账号会跟着旧目录进备份，新链接仍指向旧副本。现在测试后比对，不一致就再拷贝再测，最多三次；仍不一致则不切换。
