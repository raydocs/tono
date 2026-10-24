| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-ENTITLEMENT-CONTRACT-CODES | macOS 未识别控制面新套餐/额度/设备重验错误码，显示退回泛化的账户拒绝 | in-PR | fix/t4-macos（T6 协作） | 中·已确认（P2，XCTest RED） | 待 T6 合入与真实续费/重验联调；网络授权不自动复活 |

证据：`apps/macos/Tono/Services/TonoAPIClient.swift:132-164,1238-1244,1523-1525`。
新码 `PLAN_EXPIRED`、`QUOTA_EXHAUSTED`、`DEVICE_REAUTH_REQUIRED` 保留旧码兼容。
沿既有 entitlement 流程保留登录和设备配置、撤下网络凭据；没有改为接受已撤销身份。
RED `619cd5326`；DEVICE_REAUTH_REQUIRED 的真实 403 fixture 验证保留账户/refresh token、不 disarm。
