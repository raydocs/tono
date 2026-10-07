| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| issue-789 | Google 登录把未关联的 `sub` 按 `email`+`email_verified` 关联到已有账号，不看 `hd`；非托管外部邮箱易主后前任可接管现任账号（Google 登录当前关闭，潜伏） | in-PR | [#789](https://github.com/raydocs/tono/issues/789) · [#1435](https://github.com/raydocs/tono/pull/1435) | 中·推导 | 拒绝而非流程内邮箱挑战，非 Workspace 非托管地址之后无法关联 Google；客户端显示通用 401 文案；Google 对此类地址的 `email_verified` 行为未在线核实 |

GPT-6.1 Sol bug hunt n05-1 / n07-1（2026-09-30 决定先登记不修）。修法见 [2026-10-07-cp-google-link-authority.md](../changelog.d/2026-10-07-cp-google-link-authority.md)：Gmail 或 `hd` 等于地址域名才可选中已有账号，否则 `401 EMAIL_OWNERSHIP_UNVERIFIED`；新建账号路径不变。
