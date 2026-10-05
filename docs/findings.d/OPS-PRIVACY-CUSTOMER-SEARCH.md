| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| OPS-PRIVACY-CUSTOMER-SEARCH | 新客户搜索以掩码而非原值匹配，隐私模式下真实邮箱/微信静默查不到 | in-PR | [#1377](https://github.com/raydocs/tono/pull/1377) | 低·已复现 | 搜索使用已获权限的数据原值，显示和 tooltip 仍脱敏；本地真实 React/jsdom 运行 before privacySearchRows:0，after:1、privacyDisplayMasked:true。未合 main/部署。 |
