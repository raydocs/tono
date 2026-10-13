| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| REGLATE-MAC-MANIFEST | #1159 之前构建的 v1 读取器拒绝带 `components.singBoxSha256` 的更新清单，无法原生更新 | accepted-design | [#1240](https://github.com/raydocs/tono/issues/1240)，[#1159](https://github.com/raydocs/tono/pull/1159) | 低·推导 | 没有已发布客户版用 v1 合约；`release/macos` 与 `release/windows` 均已包含 #1159（2026-10-13 `git merge-base --is-ancestor` 核对）。#1159 之前的 0.0.73 RC / 0.0.74 测试安装需手动重装 |
