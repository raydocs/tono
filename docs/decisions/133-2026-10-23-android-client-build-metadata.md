## 2026-10-23 · Android 已发送的客户端版本标识应接到哪里？
- Status: provisional
- Chosen: 仅让既有 `X-Tono-Client: android/<version>` 进入同一个设备版本记录；继续只存最后一次合法 platform/version，沿用 macOS/Windows 的长度、字符、认证归属及 best-effort 写入边界。新增迁移0103替换该元数据列的 CHECK，不改已应用的0092，不重建 devices 表或关闭外键。拒绝顺带纳入 iOS/未知平台、开启诊断、增加历史记录、更新来源或把自报版本作为认证依据。
- Why stricter: Android 请求头已经存在，不增加请求或上传种类；其他平台的行为不变。设备 DTO、遥测统计和发布能力不变；旧/错误值不覆盖已知记录，写入失败不破坏已经完成的 token 轮转。迁移须作为完整事务，经 preview 演练和生产导出后才可按原脚本部署；本轮只交付源码和本地验证，不操作远程数据库。
- Applied in: `fix/android-client-build-identity-20261023`，ops plan §P2 Android / iOS 客户端与 §2 迁移/验证；本项只覆盖 Android 版本元数据，不改变决定130的内部测试交付边界。
