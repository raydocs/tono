## 2026-10-13 · Windows 安装器：失败的再次暂存不再破坏排队的重启候选；取消的重试向导不再放掉继承的租约
- 归属：SHIP_PLAN 门 3（G3，Windows 更新/安装失败证据）；`apps/windows/service` install_service、`installer.nsi`。
- 来源：基线 `20266ba2f`；分支 `claude/win-update-p2`；PR 待开；尚未合 main。
- 缺陷修复：`W9-DEFERRED-PARTIAL-STAGE`：`stage_service_binary` 先删再写同名 `tono-service.exe.next`，而该文件可能正是 `MOVEFILE_DELAY_UNTIL_REBOOT` 排队的重命名来源；之后一次暂存失败（复制中途出错、磁盘错误）会让重启时发布残缺文件或让更新静默丢失。现在先在 `.next.partial` 复制并校验，完整后一次 rename 覆盖 `.next`，任何失败都保留原候选。`W9-RESOURCE-CANCEL-REPAIR`：第一次向导已写入新资源后失败并回滚，其租约保留；之后的重试向导在 Sections 之前被取消时，`.onGUIEnd` 把继承来的租约放掉，App 修复随即用较新的资源去配回滚后的旧 Core。现在三种门禁（更新/孤儿/卸载）在接管一个未被交还的租约时于 reason file 留下标记（写失败则门禁拒绝，租约保留；预读等待忙碌的 store），NSIS 记 `$TonoLeaseInherited`，取消（含 `.onInit` 退出、卸载器取消）不再 finish 这个租约；只有完成的安装才交还。
- 新增/优化：无。
- 工程与测试：另有 `update_manual_gate_marks_an_inherited_lease_or_refuses`（Windows，新函数，无旧代码红）与 `a_cancelled_uninstaller_does_not_hand_back_a_lease_it_inherited`。`failed_restaging_keeps_the_candidate_already_queued_for_reboot`（旧代码红）与 `a_cancelled_retry_wizard_does_not_release_a_lease_it_inherited`（对 NSIS 模板的契约检查，不是向导运行）。
- 验证：见 PR 的 Verification。未在本机运行 cargo/NSIS。
- 候选/发布：仅源码，无新候选。
- 剩余限制：无实机验证（排队重启重命名、NSIS 向导取消）。继承的租约在取消后保持，直到一次安装完成；用户在此期间 Connect 仍被拒（与第一次失败安装后的状态相同）。崩溃遗留的 `.next.partial` 由下次暂存删除，卸载清单未列入。`R3REGW-ROLLBACK-DOUBLE-HOLD` 属 AI hold 语义决策，未改。
