## 2026-10-07 · Google 登录只接受 Google 对其有权威的邮箱（Gmail / Workspace `hd`）
- Status: provisional
- Chosen: 控制面 `accountForOidcIdentity` 对未关联的 Google `sub`：邮箱域名是 `gmail.com` / `googlemail.com`，或 `hd` 声明存在且等于邮箱域名，才按验证过的邮箱选中或创建 Tono 账号；否则返回 `401 EMAIL_OWNERSHIP_UNVERIFIED`，**既不关联已有账号，也不创建新账号**，用户改用邮箱验证码登录。已关联过的 `sub` 不受影响；Apple 不变。
- Rejected: (1) issue #789 建议的「不关联已有账号、但仍允许用该声明创建新账号」——评审（#1435 5c1a292f opus:F1 / codex:F1，major）指出反向顺序同样成立：非权威 Google 声明先替该邮箱建号并写入 email 身份，现任邮箱主人之后用验证码登录就落进这个已绑定攻击者 Google `sub` 的账号；而且「账号已存在」无法区分他人的账号和本次注册留下的账号，`createOnly` 式校验还会把身份插入短暂失败的 subject 永久卡住。(2) 登录流程内的邮箱验证码挑战——需要新的挑战状态与客户端流程，Google 登录当前关闭（`GOOGLE_CLIENT_ID: ""`），不值得现在做。
- Why stricter: AGENTS「Finish the work」第 3 条：选更严、不泄露的选项。拒绝只影响非 Gmail、非 Workspace 托管的地址用 Google 登录；这类用户有邮箱验证码路径，不会被锁在外面。Google 对非托管外部地址如何维护 `email_verified` 未在线核实，按最坏情况处理。
- Applied in: PR #1435（`services/control-plane/src/accounts.ts`、`src/oidc.ts`），记录 [2026-10-07-cp-google-link-authority.md](../changelog.d/2026-10-07-cp-google-link-authority.md)，finding [issue-789](../findings.d/issue-789.md)。开启 Google 登录前若要支持此类地址，需老板决定是否加显式关联流程（本决策转 owner 或被替代）。
