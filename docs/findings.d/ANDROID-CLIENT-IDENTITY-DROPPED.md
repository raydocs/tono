| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ANDROID-CLIENT-IDENTITY-DROPPED | Android 已发送的版本标识被 parser 和设备表 CHECK 双重拒绝，登录成功后仍没有客户端版本记录 | open | `fix/android-client-build-identity-20261023` | 低·已确认（本地 Worker/D1） | 修复源码和两项本地行为回归完成；独立审查、交付 CI、preview/生产迁移未完成，iOS/诊断上传/DTO与统计展示未改 |

- 基线 main `12ed2cfa0`；单纯将 android 加入 parser 仍被0092 CHECK 拒绝，错误被既有 best-effort catch 吞掉。
- 不改0092历史文件。0103在单个迁移事务内复制并替换元数据列，保持设备表、关联会话/出口凭据、约束、索引和触发器。固定两条回归覆盖真实路由写入和有旧数据的迁移/回滚。
- 最终旧行为源码 `b18cee576` 上，两条测试均在预期 `android/0.0.1` 却读到 NULL 的断言失败；初始 parser-only 对照也同样失败。最终修复 `07b65099c` 两条通过；最终 RED/FIX 测试源码保持不变。回滚故障使用执行时的重复主键（不是 prepare 时的缺表失败）。
- 首轮迁移 fixture 曾使用 D1 不允许的 `PRAGMA integrity_check`，得到 SQLITE_AUTH；已移除该无效检查，保留实际外键和数据检查后重跑。该 fixture 错误不算产品 RED，没执行的 SQLite integrity_check 不记作通过。
- 元数据是客户端自报值，不用于鉴权、权限、路由、发布或保护状态判断。只能声称修复存储链路，不能声称移动诊断/版本展示已完整。
