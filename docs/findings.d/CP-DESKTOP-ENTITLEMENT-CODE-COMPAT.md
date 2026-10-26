| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CP-DESKTOP-ENTITLEMENT-CODE-COMPAT | 新账户错误码落入已发布桌面普通Forbidden，套餐/续费恢复缺少正确动作 | in-PR | [#1738](https://github.com/raydocs/tono/pull/1738) | 高·已确认（Claude审查与D1回归） | 采用桌面既有码并在已恢复账户的撤权设备返回401；移动端契约已通知T2/T3，客户端/真实UI待验 |

84e567140的accounts.ts:16-23、auth.ts:52、sessions.ts:139使用新码；已发布兼容集合见macOS TonoAPIClient.swift:147-154和Windows auth.rs:922-929。49bd0fc91的回归实际用这两份集合检查返回code，到期/超额均失败；续费后预期401实际403。
修复06a5408c2：ACCOUNT_EXPIRED/QUOTA_EXCEEDED保持403、不消费refresh；只有账户已恢复后未重新授权设备才返回标准401 UNAUTHORIZED/INVALID_REFRESH_TOKEN。已失效套餐仍先被403拒绝。
