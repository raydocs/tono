## 2026-10-01 · Windows 安装事务加入 sing-box.exe

- 归属：SHIP_PLAN G1。Windows 安装、升级和静默更新。不是客户发布。
- 来源：main（已含 #1140）上的后续改动。协议仍是 18：没有新的 IPC。升级时 NSIS 先复制新的 `tono-service-install.exe`，再由它执行 `--replace-runtime`。
- 缺陷修复：无。
- 新增/优化：安装事务在 Service、mihomo、GUI 之外增加 `sing-box.exe` 和旁边的 `sing-box-sha256.txt`。摘要只能是 Windows alpha.9 `b2e6902ee75d9c4af79df28a61ded67afc4283fc83a44dee8896f3737a4ed027`。pin 已设置而文件缺失或摘要不符则拒绝升级。pin 未设置且没有 staged 文件时跳过（开发构建），三成员事务不变。第一次引入的文件回滚时删除，不编造旧字节。更新清单可以多一个可省略的 `singBoxSha256`；旧清单仍能解码。
- 工程与测试修正：打包 allowlist、NSIS 清理、发布脚本和 CI 占位路径一起改。`cargo test` 未在本机执行（rustc 1.83 不能编译 edition 2024）。
- 验证：`node --test apps/windows/app/scripts/windows-packaging.test.mjs tooling/scripts/tests/windows-package-components.test.mjs tooling/scripts/tests/desktop-update-v1.test.mjs` 41 pass / 0 fail。2026-10-01 续记：`tono-service-install` 在 Windows CI 上因 `staged_meta` 借用不能越过 `with_context` 而编译失败；改为拥有 `io::Error` 后再返回。`cargo test` 仍未在本机执行。
- 发布与部署：仅源码，无新候选。发布构建在 sidecar 不是这份 alpha.9 摘要时失败，不会装上别的 sing-box。
- 剩余限制：真实 Windows 安装尚未跑。二进制不在 git 里，发布机必须先放上这份 alpha.9 sidecar。
