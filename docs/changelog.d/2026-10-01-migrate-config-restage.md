## 2026-10-01 · 迁移时不要把测试期间更新的配置留在备份里

- 归属：ops 计划，退出节点发布布局迁移。不改客户目录。
- 来源：`origin/main`；分支 `cursor/migrate-config-restage-2c38`。仅源码，未合 main。
- 缺陷修复：`xray run -test` 期间 hub 改写的 `config.json` 会再拷贝并再测，通过后才切换 `current`。一直对不上就失败，原来的目录不动。关联 MIGRATE-STALE-CONFIG。
- 新增/优化：无。
- 工程与测试：`test_a_config_written_during_the_binary_test_is_published`。修复前迁移成功但发布的配置没有测试期间写入的账号。
- 验证：本机 `python3 -m unittest tooling.scripts.tests.migrate_config_restage_test`，修复前 FAIL，修复后 OK。
- 候选/发布：无新包。
- 剩余限制：未在退出节点执行。与 #845 可能在同一脚本上冲突，合入时要两边都留。
