| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| OPS-CUSTOMER-SEARCH-RETURN | 客户搜索后打开详情再页面返回，搜索被清空并恢复全员列表 | in-PR | [#1396](https://github.com/raydocs/tono/pull/1396) | 低·已复现 | 76925712/5c021e97 已在本地修复普通输入与深链编辑返回，概览展开也保留；仅tab内存，刷新不持久化。未合并/部署或生产验收。 |

基线实际：query=liu.yang,rows=1 → query='',rows=22；改后同流程及 q=wang.tao 深链改搜 liu.yang 后返回均 query=liu.yang,rows=1。详见[交付记录](../changelog.d/2026-10-05-ops-workbench-workflow.md)。
