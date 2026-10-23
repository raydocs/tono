## 2026-10-23 · Android 客户端版本标识接入现有设备元数据
- 归属：ops plan §P2 Android / iOS 客户端、§2 迁移与验证；本次仅 Android 控制面元数据。
- 来源：main `12ed2cfa0` → `fix/android-client-build-identity-20261023`；RED-source `d3b5ff1c2`，尚未合 main。
- 缺陷修复：登录/刷新/目录成功却丢弃 Android 的已有 `X-Tono-Client` 头；parser 只新增 android，迁移0103替换对应 CHECK，保留原 macOS/Windows/NULL 数据以及设备依赖。旧迁移0092不改。
- 新增/优化：无新请求或诊断上传；版本仍有原字符/长度上限，未知值不覆盖已有值，自报版本不参与权限。DTO/统计/发布渠道/iOS未扩展，隐私说明补齐（provisional 决定133）。
- 工程与测试：两个独立行为各一条测试；隔离 D1 从旧迁移建立带数据基线，实际检查迁移失败回滚和成功后的外键/会话/凭据/触发器。首轮无效 integrity_check fixture 的 SQLITE_AUTH 不算行为 RED；修正后两条都在 NULL 与 android 的实际断言变红，parser-only 对照仍红，完整修复2/2绿，测试字节不变。
- 验证：MacBook portable Worker/D1，Node26.12.1 / Vitest5.0.5（npm ci，未改 lock）。命令 `npx vitest run test/worker-android-client-identity.test.ts test/client-identity-migration.test.ts`；原始红/绿与 partial 对照日志保留在执行机审计目录。typecheck、合同/预算和全量 Worker tests 正在执行，独立差异审查和 exact-head CI 待完成。
- 候选/发布：仅源码，无新包、无生产部署、无客户发布。
- 剩余限制：preview/生产迁移与真实 Android API/手机未运行；不声称诊断/展示完整、生产数据已更新或新 SHA 有设备资格。Android 准备态 WIP 的最终R2已approve，运行证据仍因既有Devin额度不足而缺失，两者不是本项测试结果。
