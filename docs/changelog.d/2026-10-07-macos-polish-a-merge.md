## 2026-10-07 · macOS 打磨 A 合入 main 与批次回归审（94817af4f…c8911d9c5）
- 归属：SHIP_PLAN 0.0.75 G1/G2 外观准备（owner 2026-10-06「能合并的全都合并到 main」）；仅 `apps/macos` 呈现层与记录，不改连接、保护、helper、PF、
  路由、账户或更新逻辑；production Worker 仍是 `94817af4f`。
- 来源：[#1426](https://github.com/raydocs/tono/pull/1426) `codex/macos-polish-a-20261006`，head `07ee967c1`（= 源码 `4570901eb` + 一个只改记录的提交），
  在 `0ec8bab3f` 上无冲突 rebase，合并提交 `c8911d9c5`（merge commit，由 Claude 会话按 AGENTS.md 条件手动合并，没有开 auto-merge）。
  实现条目见 [2026-10-06-macos-polish-a.md](2026-10-06-macos-polish-a.md)（Codex）。
- 缺陷修复：无新根因；#1426 自身的一轮修复（续审 7957497e 的 6 个分片）随 PR 合入，分片状态在本条目的 PR 里改为 `fixed(c8911d9c)`。
- 新增/优化：无（本条目只记合并、验收与审阅）。
- 工程与测试：规格 `MAC-POLISH-SPEC.md` §4.2 两处勘误（2026-10-07，规格作者）：日落帧条允许 Windows 余晖保持造成的平台，改为每帧非增（1/255）、
  单帧最大降幅 ≤ 25 %、末帧为夜色；抵达曲线的 ease-out 收尾不算平台；日出/抵达按标题块以下的场景区域测量（90 ms 标题退出会让整帧均值掉一级），
  日落按整帧测量。规格文件在 `~/orca/workspaces/tono/handoff-2026-10-03-ui/review-2026-10-06/`，不在仓库。
- 验证：
  - 帧验收（规格作者，PR 评论 [6034002168](https://github.com/raydocs/tono/pull/1426#issuecomment-6034002168) 与
    [6034801982](https://github.com/raydocs/tono/pull/1426#issuecomment-6034801982)）：看过 `82b91e635` 与 `4570901eb` 两次 CI 产物里的 3×16 帧条、
    24 张整窗（en/zh × 920/1280 × 7 状态 + 5 页）、12 张辅助功能、4 张水面与标题 0–4 帧裁剪。`4570901eb`：日出场景区
    `20.8…47.8` 单调；抵达 `52.0 51.9 … 58.6` 首步 −0.1 在容差内；日落整帧 `54.0 … 22.1` 非增、最大单帧降 17.6 %、末帧 = 夜色参考；
    水面 500 ms 两帧闪光变、天空不变（connected 的 185 px 差异全在日头边缘抗锯齿）；CPU 0.37 % / 0.42 % / 0.51 %（合成宿主口径）。
    `82b91e635` 的标题双重曝光（set-00 / arrival-00 / rise-00 / arrival-04）在 `4570901eb` 消失。
  - 代码审：jev-route `3173f320`（`82b91e635`，三方，PASSED，7 minor 全部交叉确认）→ 一轮修复 → `7957497e`（`4570901eb`，PASSED，7 条由三方复核
    关闭，新增 2 条同因 minor 按止损规则留 open：R1426-opus-F1 / R1426-codex-F1，修复排 B 首提交）。回执：PR 评论
    [6034148475](https://github.com/raydocs/tono/pull/1426#issuecomment-6034148475)、[6034844744](https://github.com/raydocs/tono/pull/1426#issuecomment-6034844744)。
  - ci-gate：源码 head `4570901eb` [37596390930](https://github.com/raydocs/tono/actions/runs/37596390930)（642 XCTest / 1 skipped / 0 failures）；
    合并 head `07ee967c1` [37599813927](https://github.com/raydocs/tono/actions/runs/37599813927)。无评审线程，无 CHANGES_REQUESTED。
  - 批次回归审 `94817af4f...c8911d9c5`（#1428 记录 + #1426）：jev-route `1fe232d2`，三方（opus / codex / grok，均 high），PASSED；唯一发现
    codex:F1 = 已登记的 R1426 resize 原点问题（同根因，不重复计数）。已审范围到此结束于 `c8911d9c5`。
  - jev-route 校准（记录，不是产品事实）：Grok 4.7 在 #1426 的 Swift diff 上 low / medium / high 三档都报 clean（Opus/Codex 各有确认发现），
    代码 diff 上 Grok 的 clean 不作为证据；docs diff 上仍有用。
- 候选/发布：仅源码，无新候选、无安装、无客户发布，不编辑 owner 的 G1/G2。
- 剩余限制：真实生产 `WindowGroup` 窗口（默认尺寸、idle）尚未有人看过——所有证据来自 fixed-AppKit-surface 夹具（`toolbar=false`），留到第一个签名
  0.0.75 候选（G1）；Reduce Motion / Reduce Transparency / Increase Contrast 只有夹具注入值的截图，没有 OS 设置路径；R1426-opus-F1 / codex-F1
  open（拖拽调整尺寸时场景偏移露底，结束时复位）；包 B/C/D 未开始。
