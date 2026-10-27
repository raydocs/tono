| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| XPLAT-EXIT-REGION-TOKEN-ORDER | 出口地区规则在五处各写一份；Windows `heal::region_key`（故障转移）与 `unarmed_probe::region_of`（放行后后台重连）按词序取第一个 US/JP，而 macOS `ExitHeal.regionKey`、Windows `region_rank` 与界面 `nodeRegion` 让 US 优先，同时含两者的名字（如 `JP relay via US`）在 Windows 恢复时会被分到另一地区 | in-PR | 本 PR | 低·已确认（读码 + 共享夹具在旧代码上失败） | 现有目录名都是「城市 · 代号」，未见客户命中；五处仍是独立实现，只由夹具 `tooling/scripts/tests/fixtures/exit-region-v1/cases.json` 保持一致 |
