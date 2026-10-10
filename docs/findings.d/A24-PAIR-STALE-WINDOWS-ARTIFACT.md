| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| A24-PAIR-STALE-WINDOWS-ARTIFACT | `desktop-update-candidate.yml` 的 pair 作业下载 `tono-windows-0.0.74-candidate-<sha>`，而 `windows-candidate.yml` 上传的是 `tono-windows-0.0.75-candidate-<sha>`，成对无签名候选在 pair 作业失败 | in-PR | [#1505](https://github.com/raydocs/tono/pull/1505) | 低·推导 | pair 作业改为从 `apps/windows/app/package.json` 读版本；只有结构测试证明，未实际派发验证 |

A24（构建来源证明）审 release 工作流时发现，与本 PR 改动无关。修法是让 pair 作业的 artifact 名跟随
`apps/windows/app/package.json` 版本，并在 `windows-ci-paths.test.cjs` 的成对候选用例里断言。
