# iOS 状态权威 · 冻结与盲评第 1 轮

- 冻结提交：`a20b3c1074434a938d6c04da5b43b1f4c5ff3ad7`，PR #1672／`feat/ios-singbox-horizon`；根线程 fetch 后本地 HEAD 与 origin 一致，tracked tree 未修改。
- CI：根线程查询确认 [iOS CI 39347647852](https://github.com/raydocs/tono/actions/runs/39347647852) 及 [ci-gate 39347654152](https://github.com/raydocs/tono/actions/runs/39347654152) 均 completed/success，headSha 均为上述完整 SHA。
- 本轮冻结期间不修改产品、不推送；当前未追踪的报告草稿不属于已验证源码提交，等评审结束再归档，不提升为该 SHA 的代码证据。
- 新 UI 证据采集：[Devin session 3c14bd1f7a8d4aaa87eec9b7011c63fa](https://app.devin.ai/sessions/3c14bd1f7a8d4aaa87eec9b7011c63fa)，由 `devin_cloud.py verify --platform ios --branch feat/ios-singbox-horizon --commit a20b3c1074434a938d6c04da5b43b1f4c5ff3ad7 --brief ~/.agents/skills/devin-cloud/templates/tono-ui-capture-ios.md` 启动，未传 --mode。
- 初始 run directory：`~/.local/state/devin-cloud/runs/20261019-200728-macos-a20b3c107`；后台启动不等于采集通过，须核对 summary.json exact commit、每行矩阵的已采集或跳过理由、三段录屏与对应 contact sheet、35 项完整 UI 测试、命名无障碍结果、manifest 和真实附件。
- 当前：采集中。两份盲评尚未启动，无新分数、无否决结论。
- 两份独立盲评：①全新 Codex `gpt-6.1-sol` xhigh、worktree 隔离；②全新 Claude 桥接子任务，其唯一职责使用 Agent 工具调用一次 `director-fable`（Fable 5.1），按 `tono-ui-fable-review.md` 填 iOS／此 SHA／实际证据 run directory／第 1 轮。桥接任务不读图、不评分、不改代码，不设置 CLAUDE_ALLOW_IMAGE_READ；Fable 原文写入 `~/.local/state/devin-cloud/blind-reviews/a20b3c1074434a938d6c04da5b43b1f4c5ff3ad7/fable-r1/REVIEW.md`。
- 隔离：不读 agent-reports、changelog、PR正文或历史评分；只给不变 rubric、冻结 diff 和新采集原始证据。母线程不把本报告、历史自评或旧分数给评审。
- 最多两轮。仅独立盲评分数作为目标进度；不达标时按主题合并意见，在 WIP 分支批量修正再云验，不边评边推。
- 真实 NE、签名包、App Group 系统端到端、真机生命周期/系统刷新时延、真实服务、VoiceOver/触觉/120Hz/功耗等继续列在真机清单，不由模拟器结果勾选。

## 采集收回与 owner 受限证据授权

- 原本机 verify 轮询因 DNS 失败退出，不等于云会话中止。根线程执行 `devin_cloud.py wait 3c14bd1f7a8d4aaa87eec9b7011c63fa`，实际 exit 2，收回 `~/.local/state/devin-cloud/runs/20261019-224452-wait-3c14bd1f7/`，summary verdict **blocked**、exact commit 与冻结一致，115 个附件全部下载存在。
- 根线程核对 72 个矩阵变体：57 captured_verified、15 skipped，所有 skipped 均有原因；manifest.csv 57 项全部同一 SHA，PNG 文件及签名存在；iOS 26.5，P=iPhone17Pro，S=iPhoneSE3。
- 两个 connect-cycle 录屏与两个 contact sheet 存在，各 16 个时间戳；sheet-cycle 视频/contact sheet 缺失并明确 skipped，不能称模板全部通过。
- 新一轮 UI 原始日志 35 个 passed 方法名与源码完整匹配、零 failed/skipped；原文 `Executed 35 tests, with 0 failures (0 unexpected) in 1018.129 (1018.157) seconds`。
- 最新 owner 明确不补采、授权现有证据进行第1轮盲评。onboarding/primer/widgets/widgets-light/widgets-routes/connected-offline 与 sheet-cycle 缺口两份 brief 都列为第5节「证据未覆盖」，不因此扣分，也不猜测给分；保持 rubric 不变，实际可见缺陷仍需评判。
- zh 灵动岛/Live Activity 的 Connected/Preview 与「东京」同屏记为真实可见本地化问题 `IOS-1672-LIVE-ACTIVITY-LOCALE`；不是免评分的缺图，列入下批 WIP 修复清单，当前冻结期间未改代码。
- 两份盲评已启动：Codex gpt-6.1-sol/requested xhigh，review/async/worktree；Claude Sonnet5.5/high 桥接，general/async/worktree，其唯一职责 Agent 调用 director-fable 并原样保存报告。报告位于 `~/.local/state/devin-cloud/blind-reviews/a20b3c1074434a938d6c04da5b43b1f4c5ff3ad7/{gpt-r1,fable-r1}/REVIEW.md`。启动不等于已出分；返回后核对原文，不由母线程自评。
