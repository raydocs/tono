| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-LOGIN-RELAY-GATE | 允许 Tono 中继的保护状态下，Windows 登录 UI 仍禁用全部认证操作，并把解除保护说成登录前提 | in-PR | 本 PR（`amp/login-relay-feedback-ui`；决策 091，传输依赖 #1553） | 中·已确认（UI DOM） | 基线2ad39dba：email/send disabled=true，文案称 relays blocked；修改后合成 UI 可发送/自动验证，pending 锁保留，只有显式 Restore 才调用 UI release。真实 Service/WFP/网络未验，旧 Service 无 marker 时保留 generic；待 #1553 合入、准确 head CI/Sol 与设备验收 |

这不是“原生已经漏流”的证明。UI 门禁和错误指引可在生产组件 + 合成 IO 的浏览器/公开接口回归复现；底层状态映射、native release handler 和 transport 不在本 PR 修改范围。登录另一账号可能停止此前仍运行的连接，这一代价保留并说明。
