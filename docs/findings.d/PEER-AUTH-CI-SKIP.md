| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| PEER-AUTH-CI-SKIP | 没有 Apple Development 身份时，helper 对等授权测试打印 SKIP 并以 0 退出 | in-PR | [#956](https://github.com/raydocs/tono/issues/956) / [#964](https://github.com/raydocs/tono/pull/964) | 中·已确认 | 托管 CI 上放行用例仍跑不了：自签证书不满足 `anchor apple generic`。发布工作流在身份缺席时失败 |

macos-ci 改为跑拒绝用例，并写 `::warning::` 和 job summary。macos-release 改为直接失败。
