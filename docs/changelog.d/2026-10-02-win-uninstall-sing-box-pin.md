## 2026-10-02 · Windows 卸载删除 sing-box 旁边的 pin

- 归属：SHIP_PLAN G1。Windows 卸载。不是客户发布。
- 来源：main 361a64b8 → 分支 `fix/win-uninstall-sing-box-pin`。Fixes #1317。
- 缺陷修复：0.0.74 安装会把 `sing-box-sha256.txt` 放在 `$INSTDIR` 根目录，但卸载不删它，所以 `C:\Program Files\Tono` 一直留着。现在只在 Uninstall 段删除这个 pin，升级不会删掉正在使用的 pin。helper 的 pin 暂存名 `sing-box-sha256.txt.{next,rollback,restore,publish}` 也加进 `RemoveKnownLegacyPayload`，并加进 `WINDOWS_RUNTIME_REPAIR_ARTIFACTS`（发布前检查会强制要求）。
- 新增/优化：无。
- 工程与测试修正：`windows-packaging.test.mjs` 增加一个回归测试：Uninstall 段必须删除根目录 pin，真实模板必须通过 `validateNsisLegacyCleanup`。
- 验证：`node --test apps/windows/app/scripts/windows-packaging.test.mjs` 38 pass / 0 fail。新测试在改动前失败。真实卸载未跑（needs-hardware）。
- 发布与部署：仅源码，无新候选。现有 36e3194d 候选保留这个问题（只是残留文件，不影响网络）。
- 剩余限制：Service 卸载器仍留下 `%ProgramData%\Tono\bin\sing-box-sha256.txt`（外观问题，见 findings 分片）。
