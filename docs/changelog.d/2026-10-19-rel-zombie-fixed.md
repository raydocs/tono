## 2026-10-19 · 记录：REL-ZOMBIE-UNIDENTIFIED 改为 fixed

- 归属：G2 记录维护；`docs/findings.d/REL-ZOMBIE-UNIDENTIFIED.md`。
- 来源：`origin/main` → 分支 `docs/rel-zombie-fixed`；修复本身是 [#1691](https://github.com/raydocs/tono/pull/1691)（合并 `fb67c3c2`）。
- 缺陷修复／新增：无。状态由 `in-PR` 改为 `fixed(fb67c3c2)`，剩余限制补「待实机」（需新签名版本到客户机）。
- 验证：`node tooling/scripts/records.mjs findings --status fixed` 列出该条。
- 剩余限制：同上。
