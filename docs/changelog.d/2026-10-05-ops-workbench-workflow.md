## 2026-10-05 · ops 客户列表与本次节点任务闭环
- 归属：[运维计划](../ops/plan-2026-09-11.md)、[后台改进路线](../ops/console-improvement-2026-10-04.md)第二/第五批的小步交付，不推进客户发布门。
- 来源：`cccec2a629180d72d2b170a803008c12600d7f9c` → 实现 `7692571204658cc5c09f9034ee11cd7fc304ddfd`，返回时概览展开偏好续修 `5c021e97e7719e2e608def59c3ffac5bd7a8c27b`；分支 `ops/workbench-workflow-20261005`、[#1396](https://github.com/raydocs/tono/pull/1396)，尚未合入/部署。
- 缺陷修复：`OPS-CUSTOMER-SEARCH-RETURN`，搜索→客户详情→页面返回由清空搜索改为保留输入；沿用既有筛选、排序、滚动偏好。不同 q 深链接重新播种搜索，同一深链编辑后的输入返回仍保留。仅 tab 内存，不新增 URL、磁盘缓存或自动恢复写意图；隐私匹配规则未改。
- 缺陷修复：`OPS-NODE-JOB-TRACKING`，节点入队提示不再五秒消失后让操作员去页面底部找结果；每个本页新任务保留独立状态卡，按 POST 返回的任务 ID、节点主体关联任务，按同一 jobId/节点/动作类型关联变更回执。
- 新增/优化：客户用量/到期统计保留在可展开概览，列表优先；状态卡只读刷新，区分排队、执行、执行完成、失败/取消/过期、读取未知和回执待验证。任务完成或配置刷新不宣称连接恢复。
- 工程与测试：无依赖、合同、Worker、权限、确认、幂等、告警、迁移或生产数据写入变更；按 ops 计划不新增 UI 单测/E2E案例，不重生成截图基线。
- 验证（MacBook，当前实现树）：typecheck/lint 成功，棘轮 `197 (baseline 219)`；窄测 `3 files / 52 tests passed`；全量现有单测 `44 files / 345 tests passed`。build 预算 `initial JS 205.1 KB / total JS 318.6 KB gzip / all budgets green`，源码无超过400行文件。
- 浏览器（本地 fixture，Ego space20）：1600×968 下表格 top `983 → 545`；390×844 下 top `600`、整页横向溢出 `0`。原实际 `before query=liu.yang,rows=1 / after query='',rows=22`，现返回仍 `query=liu.yang,rows=1`；带 q=wang.tao 深链编辑后返回也保留 liu.yang；展开概览后详情返回 `query=liu.yang,open=true,rows=1`。
- 节点浏览器：本地真实 fixture 入队，超过5秒仍有同一任务卡，GET reads=4 / enqueue POST=1；注入读取失败后显示未知且没有再次入队；真实 fixture 取消返回200，卡显示已取消。成功/其他任务回执/错节点回执/匹配回执/回执503通过客户端只读响应注入核验；不是执行器或生产节点验收。
- 本机 Playwright：首次 grep 过窄 `No tests found`；修正 grep 后 Chromium headless shell1243缺失，启动0ms失败，行为与像素检查未执行；未安装浏览器/工具链。完整既有 Linux 行为检查交 CI（忽略 macOS 像素基线），CI 尚待结果。
- 图像均为 fixture：[桌面列表](../ops/evidence/2026-10-05-workbench/customers-desktop.png)、[手机列表](../ops/evidence/2026-10-05-workbench/customers-phone.png)、[本次任务](../ops/evidence/2026-10-05-workbench/node-job.png)。不含生产客户数据。
- 候选/发布：仅源码，无新客户包/候选/更新源变更；UI PR 不启用自动合并。
- 剩余限制：任务卡生命周期为当前对象页面，刷新/离开后从既有任务记录追溯；旧同步退役路径未伪造任务 ID。当前任务若不在返回列表中，显示未知而非用最新一条替代。服务端分页搜索、全后台刷新失败状态、邮件健康和经营报表未在本批实现；无生产登录后操作验收。

### 2026-10-05 · 审查续修
- trusted main 路由 `01fc660c` 选择 single/Anthropic；实际 Claude CLI `claude-opus-5-5 --effort high`、plan权限、仅 Read/Grep/Glob，覆盖 `cccec2a6…dec9fdfc` 当前源代码及实际 Worker 契约，不复核整个审计报告。首启动因主检出 HEAD 生成空diff已终止，未计通过；一次纠正后实际407行diff完成审查，0 major、3 minor。
- 决定性 minor：初稿等待 `identity_sync`/`xray_restart` 回执，但 Worker 实际只有下架/上架写带 jobId 的回执；初稿 xray 响应注入不证明后端支持。`cf03e21d7bc4579962110b9554b7854d6c09652c` 改为仅等待已提供的两类，其余明确“不提供变更回执”，不补虚假后端语义。另两个 minor 为终态手动读取引发重复资源刷新、登录过期通用文案；同轮加每任务终态刷新去重、显式登录过期提示。未上线初稿的问题不冒充新增已发布客户故障。
- 续修最终源码：typecheck/lint、既有44文件345例、build预算205.1KB/318.6KB通过。真实 Vite SSR + jsdom 的当前组件（临时探针，不新增仓库UI测试）实际 `jobReads=1,receiptReads=0,completed=true,noFalseWait=true`；会话过期 `explicit=true,unknown=true,paused=true,receiptReads=0`。
- `dec9fdfc` 的 ci-gate [37410046100](https://github.com/raydocs/tono/actions/runs/37410046100) success，后端/合同/代理/迁移/四个既有E2E分片成功，未触及原生任务合法skip。这是续修前准确head的结果，不替代续修后的 CI；修正delta独立复核与最新head CI待结果。未合并/部署。

### 2026-10-05 · 合入与生产部署（UTC 2026-10-06）
- 修正增量 `dec9fdfc…cf03e21d` 同槽独立复核完成：三项修正确认，无新 major/minor；三个文案 nit 保留为工程限制。最终 head `75f8bbefa12b8bb42ef9090cc24896453045749e` 的 ops-console 源码与 `cf03e21d` 相同。[审查回执](https://github.com/raydocs/tono/pull/1396#issuecomment-6009008337)记录 decision、slot、准确范围与限制，不沿用首启动空diff。
- exact-head [ci-gate 37411070895](https://github.com/raydocs/tono/actions/runs/37411070895) completed/success：control-plane、合同、代理、迁移及四个既有 UI E2E 分片成功；未触及原生任务合法skip。仍未比较 macOS 像素基线，未新建 UI 测试或重生成基线。
- PR #1396 手动 merge-commit 于 `2026-10-06T04:00:42Z` 合入 `e93e6cb22f79dc6e99ff47456c493f5833623abd`，父提交 `a05dac5e` 与准确 head `75f8bbef`；未启用 UI auto-merge。
- 集成核验：`75f8bbef…e93e6cb2` 的 control-plane/ops-console/部署脚本 `git diff --exit-code` 无输出，沿用本PR准确源树的两段审查。部署产物范围 `e8ce5f38…e93e6cb2` 仅九个已审 ops-console 源码变化，无新后端/依赖/迁移/权限/写语义或 merge-resolution；期间 main 的原生/CI、hub/exit-agent 改动不在本次 Workers 产物，不发布客户包、不部署节点/hub，也不作为那些独立产物的审查批准。[集成回执](https://github.com/raydocs/tono/pull/1396#issuecomment-6009071022)。
- 部署前 maintainer `/Users/ruirui/Downloads/GitHub/tono` 的 clean main ff-only 到 `e93e6cb2`，Wrangler `Active profile: tono`。D1 导出和远端 sidecar 上传完成：`backups/control-plane-d1/2026-10-06T03:54:14Z.sql.gz`，6354104 bytes，SHA-256 `9d798e4c198383e5a3df6a32d1db802c95cdfe9d1ebcb2163c7c9237dbe97329`；远端摘要与本地一致，`shasum -c`/`gzip -t` 通过。未查看 SQL 内容、写生产数据或恢复数据库。
- `services/control-plane` 的正式 `npm run deploy` exit0：集成 typecheck、现有44文件1000测试、policy-signing 源码合同检查、console build、release-center check 通过；预算205.1KB/318.6KB全绿。远端迁移实际 `No migrations to apply`，既有 schema fence 检查通过；未运行本机原生构建。
- 两 Worker 已部署同一源码：API version `d007e710-b9ad-4e6d-adaa-a928b3cb0c99`，admin version `23c1d083-b6ef-4f93-a142-ab6c007e032d`；版本元数据均 `BUILD_SHA=e93e6cb2…`、tag `main-e93e6cb22f79`、message `source main@e93e6cb2…`。在线 [API version](https://api.afk.ccwu.cc/api/v1/system/version) 返回完整 `e93e6cb22f79dc6e99ff47456c493f5833623abd`；pulse `ok:true,cronAgeSec:159` 且同 SHA。[ops 入口](https://admin.afk.ccwu.cc/ops/) 未登录返回302至既有 Access 域，不称为生产登录后验收。
- 四个本轮 finding 已修复部署；原稿“未合入/待CI/未部署”保留为历史状态，以本续记为最新结果。没有客户包、候选、更新源、邮件/TG 规则或发布门变化。
- 剩余限制：任务卡只在当前对象页内保留；生产节点动作、邮件投递和登录后 UI 未在本次触发验收；缺少本机 Playwright 浏览器/macOS 像素证据。noReceipt 与未知/安全说明并列、会话过期短标题等三个文案 nit 已记录，不影响任务关联或写语义。服务端分页搜索、经营报表和全后台读失败状态仍未实现。
