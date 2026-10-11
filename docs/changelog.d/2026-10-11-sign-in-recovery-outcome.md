# 2026-10-11 · 登录恢复结果的类型化原生契约（决定 093）

- 归属：SHIP_PLAN 0.0.75 收口（登录清理 / 客服后置的原生交接，owner 经 Puck 2026-10-11 授权）。分支 `amp/login-recovery-outcome`。
- 新增/优化：
  - Mac `AccountSession.signInRecovery`、Windows `TonoStatus.signInRecovery`：每次登录请求（发码；验证码到采用会话）的
    `operation`（代际）、`step`、`phase`（`automatic` 进行中 / `userAction` 已结束、无自动尝试待执行）和 allowlist `cause`。
    新请求、取消/换邮箱/退出、成功（含已发码）清除旧结果；被替换请求的迟到结果不落地。等待邮件、验证码错误、限流、设备上限不算网络穷尽。
  - Windows 新命令 `tono_sign_in_dismiss`（换邮箱时清除）；`services/tono.ts` 增加 `TonoSignInRecovery` 类型与 `tonoSignInDismiss`。
  - 保护状态独立：记录/清除结果不读不改 kill switch / PF / WFP，后台保护恢复不写它。UI 只在 `userAction` 时显示低强调客服入口（UIUX 负责 UI）。
- 回归：Windows `sign_in_recovery` 三个单测（全 relay 失败 → userAction/relaysUnreachable；成功重试清除；旧代际与 dismiss 后迟到结果不落地）
  与 `a_sign_in_outcome_and_protection_recovery_do_not_touch_each_other`；Mac `SignInRecoveryTests`（全 relay 失败且不解除保护、成功重试清除、
  运行期失败不改结果、旧请求迟到不落地、取消清除）。
- 验证：见 PR 回执（Linux 本机 `cargo test --lib sign_in`；Mac XCTest 仅托管 CI）。仅源码，无新候选。
- 续记（2026-10-11，Sol #1564 回执 @372f5de79：PASS，M1 minor 一轮修复）：Windows 发码的登录准入（`sign_in_generation` 递增）与恢复令牌原在两次加锁中取得，
  旧请求可在两锁之间排到新请求之后，留下永远 `automatic` 的结果，或在退出登录后登记新令牌并发布失败。改为同一临界区内准入并开始（`begin_sign_in_request`），
  结束时同时核对认证代际与令牌（`finish_sign_in_request`）。回归 `a_superseded_or_signed_out_code_request_leaves_no_stale_recovery_outcome`（经真实
  `close_account_with` 退出）；Mac 运行期隔离测试补非空前置断言。本机 Linux `cargo test --lib tono::commands` 78 通过、`sign_in` 16 通过、cleanup 5 通过。
