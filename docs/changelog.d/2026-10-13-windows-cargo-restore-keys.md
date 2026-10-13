## 2026-10-13 · Windows CI：Cargo 缓存按同一 rustc 回退

- 归属：工程流程（CI 提速），不属于 SHIP_PLAN 门或运维计划条目。只改 `windows-ci.yml` 和它已有的路径测试。不改产品。
- 来源：main `86fe66dca` → 分支 `cursor/windows-cargo-restore-keys-ef49`。未合 main。
- 缺陷修复：无。
- 新增/优化：`core`、`app-rust`、`service` 的 `actions/cache/restore` 增加 `restore-keys`，前缀是 `cargo-v1-<job>-<runner.os>-<rustc hash>-`，不含 lockfile 哈希。精确键未中时复用同一编译器编过的 `target/`，Cargo 再编变过的 crate。精确命中仍是 `cache-hit=true`；回退记为 `fallback` 并写明命中的旧键。只在 push 到 main 且精确键未中时保存新键，与原来一样。不跨 rustc 版本回退。
- 工程与测试：`windows-ci-paths.test.cjs` 一条用例，锁三个 job 的前缀、`restore-keys`、fallback 文案，以及 save 步骤不带 `restore-keys`。
- 验证：本地未装 `apps/windows/app` 的 js-yaml，该 cjs 未跑。YAML 用 Python 解析通过。托管 Windows CI 待本 PR。
- 候选/发布：无新包。
- 剩余限制：本 PR 的 lockfile 与 main 上已保存的键相同，预期仍是精确 hit，看不到 fallback 的耗时差。fallback 要等下一次 lockfile 变化。回退的 `target/` 可能让个别指纹失效后重编，不会把旧产物当成新测试通过。
