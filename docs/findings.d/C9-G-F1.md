| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| C9-G-F1 | preview 渲染只校验 D1 UUID 形状，不拒绝已提交配置里的生产 database_id，预览 Worker 会绑到生产库 | fixed(2152f725) | [#959](https://github.com/raydocs/tono/pull/959) | 高·已确认 | 生产库换 id 后这份硬编码集合会过期，与主机名拒绝表同类；有意使用别的已有库 id 仍不被拒绝 |

缺少的约束：`previewDatabaseId` 在 UUID 格式通过后直接写入 API 与 admin 两份生成配置的 `d1_databases`。主机名和 R2 桶名已有生产拒绝，库 id 没有。影响：预览部署读写真账户、会话和目录。
