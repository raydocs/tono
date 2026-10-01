## 2026-10-01 · Windows 候选的 tsc 垫片不再 ENOENT

- 归属：工程（未签名 Windows 候选 `windows-candidate.yml` 的 typecheck）。不是 G4，不发布。
- 来源：`origin/main` `7d9e8bad` 的 [run 36817280536](https://github.com/raydocs/tono/actions/runs/36817280536)；#837 合入后的 `services/unchecked-index-ratchet.mjs`。本分支尚未合 main。
- 缺陷修复：无产品缺陷。
- 新增/优化：无。
- 工程与测试：`pnpm typecheck` 把 `./node_modules/.bin/tsc` 交给 `spawnSync`。Windows 上该路径没有无扩展名文件，只有 `tsc.cmd`，于是 `ENOENT`。Linux 的垫片仍在，所以 PR 的 Linux CI 是绿的。现在优先用本机 Node 跑 `typescript` 包 bin 字段指向的 `bin/tsc`（TypeScript 7 不导出 `./bin/tsc` 子路径）。解析不到时，Windows 改为 `tsc.cmd` 且 `shell: true`。控制面、admin、运维台、Windows 前端四条 typecheck 都走这一个入口。
- 验证：`node --test services/unchecked-index-ratchet.test.mjs`。没有派发签名或发布工作流。
- 候选/发布：仅源码，无新候选。
- 剩余限制：本机不是 Windows，`.cmd` 分支只做了计划断言。真正的 `pnpm typecheck` 要等合并后的 `windows-candidate.yml`。
