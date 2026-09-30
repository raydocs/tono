## 2026-09-30 · Windows 登录客服复制保留安全错误分类
- 归属：SHIP_PLAN §2 item 10；Windows 登录前端，发现 `WIN-LOGIN-SUPPORT-DIAGNOSTICS`。
- 来源：基线 `90cc2bed` → `fix/windows-login-network-20260930` 本地未提交源码；PR 待开、未合 main。
- 缺陷修复：发送/验证登录失败原只复制翻译文案；现单独复制认证阶段、已知稳定错误码和可解析的 pinned/system-dns 或直接传输分类。重试/换邮箱/重置清除旧摘要。
- 新增/优化：诊断严格白名单，只输出固定阶段、固定错误码、`dns/connect/tls/timeout/other`；不复制任意 raw/detail、验证码、密码、token、账户/设备/challenge 标识、URL、请求/响应内容。既有有意邮箱字段保留，用户可见翻译不变。未改 transport、TLS、WFP、认证并发或请求策略。
- 工程与测试：新增真实 UI → services/tono → SupportContact → clipboard 回归及独立未知错误隐私回归；旧登录测试仅补真实稳定错误码 helper mock。初跑 fixture 的 clockSkew 路径写错导致 1 failure，修正为真实 locale 键后通过；这不是产品缺陷。
- 验证：MacBook 上仅复用既有 JS 依赖（临时链接，已移除），未安装。实际将本任务拥有的 login.tsx 临时替为 `90cc2bed` 旧文件，新行为回归 1 failed / 1 skipped（Copy 缺字段）；finally 字节恢复，改后 `vitest run src/pages/tono/login-support.test.tsx src/pages/tono/login.test.tsx` 为 2 files / 12 tests passed。三份触及 TSX 的 ESLint、Biome format 和 `git diff --check` 通过；曾执行非 native `tsc --noEmit`，exit 0。原始日志和恢复收据见 `/tmp/tono-win-support-61.details.md`（本机临时证据，根线程负责持久化/CI）。未跑全测试套件、原生 Cargo/Tauri/Core、托管 CI、独立审查或 Windows 实机。
- 候选/发布：仅源码，无新候选；未提交、合并、部署或发布。
- 剩余限制：只改善诊断，不证明或修复首次登录网络可达性。未知/未来错误格式只输出固定阶段与 `(none)` 或已知码，未识别传输分类不猜测；根线程负责准确 head 的 hosted CI 和审查。

### 2026-09-30 · Root 集成并公开交接
- root 独立检查真实 UI/clipboard 新测试、actual old-source red 原始 log、byte restore 收据和 scoped diff；重新复用既有 JS 依赖执行两份登录测试，2 files / 12 tests passed，无跳过；窄 ESLint / Biome / diff-check 通过。未编译本机 native 组件。
- 修复与 regression/records 同步推送 `fix/windows-login-network-20260930` 并开 draft PR；精确 head 的 Windows hosted CI 和 gpt-6.1-sol/high 独立隐私/重置范围审查待完成，未合 main。前面的本地未提交状态是历史交接状态，由本段推进。
- 此交付只修 Copy 诊断缺失；不能当作客户首次登录连通性已修、未更新本机 Tono，也无候选或客户发布。
