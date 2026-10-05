| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| OPS-LEGACY-FILTER-URL | 不可迁移的旧私人搜索词被复制到 legacyFilter 并持久留在新 URL | in-PR | [#1377](https://github.com/raydocs/tono/pull/1377) | 低·已复现 | legacyFilter 仅保留值1，丢弃无法应用的搜索/筛选原值；支持的新 q 本身仍是可分享的搜索 URL。before privateFilterRetainsEmail:true，after:false。未合 main/部署。 |
