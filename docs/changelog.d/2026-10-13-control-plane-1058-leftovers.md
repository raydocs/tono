## 2026-10-13 · Issue #1058 的 control-plane 剩余行：粘贴密码、入驻角色、活动分钟上限
- 归属：ops 计划（control plane）；`services/control-plane`。
- 来源：Issue #1058；决定 [124](../decisions/124-2026-10-13-home-paste-and-onboard-line-stay-strict.md)（provisional）；分支 `claude/foundations`；尚未合 main。ops-console 四行（O1-*）已由 #1607–#1609 修复，不在此 PR。
- 缺陷修复：`SOL-CP-HOME-PASTE-PASSWORD`：粘贴已存在的同元组家宽线路但密码不同，原来静默保留旧密码；现在返回 `409 HOME_PASSWORD_DIFFERS`（待轮换标记的线路仍以粘贴密码完成轮换），入驻在写入前同样拒绝。`SOL-CP-ONBOARD-ROLE`：operator 角色经入驻的 `line` 间接创建/修改家宽库存（该操作本需 `settings.publish`）；现在带 `line` 的入驻要求 `settings.publish`，不带 `line` 或用 `homeExitId` 绑定已有线路不变。`SOL-C4-ACTIVITY-OVERLAP`：同一设备相互重叠的遥测窗口（如 22 分钟窗口每 20 分钟一个）把重叠分钟重复相加，一小时超过 60 分钟；写入时对每设备每小时的在线/连接分钟封顶 60，读取时同样封顶以覆盖已写入的旧行（旧行不改写）。
- 已因旧版 admin 在 50a94765a 退役而消失（状态 fixed(50a94765a)）：`SOL-CP-ADMIN-REFRESH-DEFAULT`（`admin/src/hooks.tsx` 已删除，无 localStorage 读取）、`SOL-CP-ADMIN-HY2-IDENTITY`（`admin/src/lib/catalog.ts` 现仅含 `catalogProxyNames`，无建节点身份逻辑）、`SOL-CP-ADMIN-USERS-PAGE`（`admin/src/api.ts` 的 `users` 无调用方；服务端列表的分页不变）。注意：ops-console 的 `getAllJson` 仍在 2000 条截断且 `App.tsx` 丢弃 `nextCursor`（客户 2001 起不可见），此项未在本 PR 修复，已记录在该 findings 的剩余限制中。
- 新增/优化：无。
- 工程与测试：`refuses a pasted home line that carries a different password than the stored one`、`an operator cannot create or change home inventory through onboarding a pasted line`、`never books more than 60 minutes of one device in one hour`。
- 验证：见 PR 的 Verification 一节。
- 候选/发布：仅源码，无新候选；需部署 Worker。
- 剩余限制：重叠窗口只封顶、不去重（分钟数是上界，不是精确在线时长）；`SOL-CP-PROFILE-PORT` 在另一个 PR（需要迁移）。
