| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-HEAL-UNGATED-HY2-HOP | Windows 粘性自愈（`connection/heal.rs` → `tono_core::heal`）在选中节点第一次连接失败（屏障未验证）后，把下一次拨号改成同一节点的 ` · hy2` 块（同基名换传输排第一），不看任何控制面开关，违反 SHIP_PLAN G2.8「自动切换默认关」 | in-PR | A17 Windows（`amp/a17-hy2-auto-switch-windows`） | 中·推导（读码，未实机） | 只影响目录里带 hy2 块的账户（`X-Tono-Accept: hy2` 且在 `HY2_CATALOG_EMAILS` 灰度名单内）。修法：自愈候选里去掉非用户所选的 hy2 块，自动换 hy2 只走 A17 的 `hy2AutoSwitch` 门（决定 082）。Windows 原生测试与实机未在本机运行，以托管 CI 为准；待实机 |
