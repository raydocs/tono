| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| PEER-AUTH-CI-SKIP | 没有 Apple Development 身份时，helper 对等授权测试打印 SKIP 并以 0 退出 | in-PR | [#956](https://github.com/raydocs/tono/issues/956) / [#964](https://github.com/raydocs/tono/pull/964) | 中·已确认 | 托管 CI 上放行用例仍跑不了：自签证书不满足 `anchor apple generic`。发布改用已导入的 Developer ID，缺这张身份才失败 |

macos-ci 改为跑拒绝用例，并写 `::warning::` 和 job summary。macos-release 在导入 Developer ID 之后用那张身份跑放行用例。
