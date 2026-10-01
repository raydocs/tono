# Grok A12 共享核心清点（2026-10-01）

Fixer: Grok 4.7。范围：`apps/windows/crates/tono-core/src/` 下从未单独清过的 `auth`、`policy`、`policy_signature`、`catalog`、`heal`、`connection`、`update_journal`（含 `update_journal/store.rs`）、`update_contract`、`recovery`、`network_disposition`、`customer_failure`、`credentials`、`protected_connectivity`。基线：`origin/main` `50bbbbf0`。

关注点：策略签名被绕过或认错钥匙、崩溃后日记/恢复状态把网络留在封锁、自愈/连接状态机标志不复位、不可信输入 panic、凭据进日志。

## 已修

无。这一轮没有达到「单条现实路径会造成断网、崩溃、鉴权绕过、账单损坏或数据暴露」的缺陷。没有新 issue。

## 跳过的重叠

开 PR 前查了 `gh pr list --state open` 和 `git ls-remote`。

| 项 | 原因 |
|---|---|
| [#797](https://github.com/raydocs/tono/pull/797) `codex2/ai-direct-suffix-guard` | 已改 `policy.rs`：签名策略不能把 OpenAI 等助手后缀做成 DIRECT。本轮不改这个文件。 |
| `hunt/sol-win-trust-*` | 远端没有这个前缀。最近的 trust 分支是 `hunt/sol-trust-vault-write-retry`（[#843](https://github.com/raydocs/tono/pull/843)），改的是应用层 `app/src-tauri/src/tono/credentials.rs`，不是本 crate 的 `credentials.rs`。 |
| 其余 `hunt/sol-*` / `codex*` 开着的 PR | 文件列表里没有本轮这份 crate 文件。 |

## 驳回

| 假设 | 为什么不是缺陷 |
|---|---|
| 错钥匙或垃圾 base64 被当成 Trusted | `verdict_with_key`：空签名是 Unsigned；坏 base64、长度不是 64/32、验签失败都是 Untrustworthy。单测用另一把钥匙对生产公钥验，结果是 Untrustworthy。 |
| 未签名策略跳过编译期域名表 | `install_with_key` 先拒绝 Untrustworthy。`trusted` 只在验签成功时为真，未签名仍走 allowlist。未签名的媒体 IP 整段丢弃（#318）。 |
| 同一修订号补上签名后，`revision_authenticated` 没闩上，未签名修订号又能往前推 | 闩只在「签名覆盖了文档里的 revision」时落下。没有内嵌 revision 的旧文档，签名盖不住信封上的修订号；这是 #317 把被伪造高修订号钉住的客户端救回来的路径，不是主机信任被绕过。生产启动用 `PolicyTracker::from_cached`，会按同一条件重算闩。 |
| 信封修订号和签名文档不一致 | `validate_policy_with_trust` 在两边都有 revision 且不相等时返回 `InvalidResponse`。 |
| 助手域名经 DIRECT 后缀漏出 | 就是 #797，已有开着的 PR。 |
| `routingSha256` 可省略，于是能换掉住宅 SOCKS | 注释写明：字段在场才必须匹配。省略是旧目录的合同，不是验签失败被当成成功。改缓存文件的是本机同一用户，低于单故障门槛。丢弃原因只带 `host:port`，不含密码。 |
| 刷新令牌出现在 `ApiError` 或本 crate 的日志里 | 本 crate 没有 `tracing`/`log` 调用。`map_status` 的 `Server.message` 来自服务端错误信封，不是请求体。JWT `exp` 解析失败返回 `None`，不 panic。邮箱拆分先要求恰好两段。 |
| `FileCredentialStore` 把令牌写进错误或在锁中毒时 panic | 生产 Windows 凭据不在这个 crate。文件存储只把 IO 错误放进 `CredentialError::Store`。锁中毒同样变成错误。权限 0600，临时文件加改名。 |
| 非法日记相位被当成成功，或未保护的捷径在 kill switch 仍武装时提交 | `advance` 把非法边写成 `Failed` 并返回错误。`FirstLaunchMigration → Verified` 要求 `!was_connected && !keep_kill_switch_armed`。过期日记保留原字节并返回 `InvalidData`，不删除。`Committed`/`Idle` 在下次 `load` 时删文件。 |
| `retire_completed_legacy` 在新版本一启动就删掉仍写着 `keep_kill_switch_armed` 的日记，于是网络一直被挡 | 这是 H15-F3 的既定行为：运行版本 ≥ `next_app_version` 就归档原字节并删文件，避免 0.0.72 的日记过期后永久告警。单测明确覆盖「武装着的 `ConnectionQuiescing` 在目标版本上被归档」。WFP 是否保留由服务的更新存储和 `retire_unverified_on_service_start` 决定，不由这份日记决定。`record_first_launch_migration` 目前没有生产调用点；把它当成「删了就一定断网」没有证据。不改，以免把永久「更新未完成」告警找回来。 |
| `version_at_least` 把预发布号当成正式版 | 比较前丢掉 `-`/`+` 后缀。没有一条能单独把非严格模式的整机流量留下的路径。 |
| `tunnel_died` 在未武装时仍返回 `KeepBlockingAndReconnect` | 返回值的调用方都不用。`connect_succeeded` 拒绝未武装或未验证的成功。`is_protection_blocked` 跟的是真实的 `kill_switch_armed`。`debug_assert` 表达的是「活隧道意味着已武装且已验证」。 |
| `initial_release_failed` 清掉验证闩，界面显示已放行但 WFP 还在 | 它保留武装闩，并按真实武装状态设置 `is_protection_blocked`，同时清掉卡住的 `is_disconnecting`。这是为了避免界面显示未连接、下面却还在拦。 |
| 自愈在 `FailOpen` 之后不复位 `protection_armed` | `note_protection` 在武装变未武装时应用 `pending_dial`。Windows 普通失败走 `KillSwitchStance::Ordinary`，效果是 `FailOpen`，再走显式释放。严格档才是 `HoldClosed`。选择性 AI 钩子是进程级 `OnceLock`，单测不注册它。 |
| 耗尽保护时忽略严格开关，或把普通失败留成全封锁 | `exhausted_protection_using` 先看严格，再看钩子，否则完全释放。`customer_failure::disposition_after_exhausted_failure` 只是这一个函数的包装。 |
| DoH JSON 或私网答案 panic / 被采纳 | 非 JSON 得到空列表。非公网 IPv4 被丢掉。 |
| 调用方取消后恢复守卫被提前丢掉 | `reconcile_recovery` 在独立任务里持有守卫。单测覆盖取消后守卫仍在。 |
| 控制器或混合代理成功就能标成 Connected | `classify_post_lock` / `classify_exhausted_data_plane`：TUN 失败就是重试，不是 Connected。离线单独归类，不暗示要重启核心。 |
| 目录 YAML 摘要或符号链接缓存被当成已验证 | 摘要不符是 `InvalidResponse`。Unix 缓存拒绝符号链接、别人的 uid、组/其他可读、空文件和超过 2MiB。 |
| 更新合同可以跳阶段提交 | `Receipt::propose` 是纯提案。相位、世代、组件和保护观察对不上就拒绝。`Observation` / `Context` 没有 `Deserialize`。模块声明本身不产生保护效果。 |
| 策略缓存临时文件只带 PID，崩溃后再撞上同一 PID 就写不进 | 要同时有崩溃残留和 PID 复用。两件独立故障，最多 P2，不立案。 |
| `"tls handshake timeout"` 被分成 QUIC，于是不切到 hy2 | 分类顺序确实先匹配 `handshake timeout`。武装后的普通失败仍然 `FailOpen`，不会因此把整机留下。不改路由、不放开 AI 拦截。低于本轮门槛，不立案。 |

## 覆盖

读了列出的每个模块的生产路径，以及日记在 Windows 启动时的唯一调用（`retire_completed_legacy_journal`）、自愈效果在 `connection.rs` 里如何变成释放、策略安装的修订号闩。`cargo test -p tono-core` 没跑：没有产品改动。

假设 28 条。核实并修复 0。驳回 27。因重叠跳过 1（#797）。
