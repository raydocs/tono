## 2026-09-26 · Windows：签名应用前缀在 Program Files 停止点加查盘符根
- 归属：G1（保护不得放宽：reviewed 直连的 WFP 规则 H）；Windows App `tono/signed_apps.rs`。#633 的续修。
- 来源：基线 origin/main `f2e24512`（#633 已合）；红分支 `wip/win-signed-prefix-drive-root-20260926-red`（`cee1b5e1`），修复分支
  `fix/win-signed-prefix-drive-root-20260926`，[#634](https://github.com/raydocs/tono/pull/634)；未合 main。
- 缺陷修复：#633 的安装链检查走到 `X:\Program Files[ (x86)]` 就判成功，不读盘符根。跳过根目录是有意的：根目录允许
  Authenticated Users 新建文件夹，这伤不到已存在的 Program Files。但这样也跳过了根目录上能替换该子目录的权限：
  非管理员 SID 持有 FILE_DELETE_CHILD、WRITE_DAC、WRITE_OWNER、GENERIC_ALL，或根目录所有者不是管理员。任何盘上
  名为 `Program Files` 的目录都只凭名字被接受（#633 审查 opus F2 = codex F1；Refs [#333](https://github.com/raydocs/tono/issues/333)）。
  改后：走到停止点时再读 `X:\`，要求所有者为 Administrators/SYSTEM/TrustedInstaller，且其余 SID（CREATOR OWNER 除外）
  的允许 ACE 不含上述四项权限；读取出错同样退回精确正则。新建文件夹权限（0x4）与默认仅继承的
  DELETE|GENERIC_WRITE|GENERIC_READ|GENERIC_EXECUTE（AU）仍放行，因为 GENERIC_WRITE 映射为 FILE_GENERIC_WRITE，不含删除子项。
- 新增/优化：无。根目录可替换 Program Files 的机器从目录前缀降为单文件精确匹配（收紧，不放宽）。
- 工程与测试：新增一个 `#[test]` `program_files_prefix_requires_a_drive_root_that_cannot_replace_it`。默认根目录
  应得到前缀；AU 持有四项权限中任一项、用户拥有根目录、根目录读取出错，这些情况都不得到前缀。
- 验证：未在本地编译（MacBook 不是构建机）；以 `windows-ci`（`windows-2025`，Tauri crate `cargo test --locked`）为准，
  PR 提交时尚未出结果。红分支只含测试，应按断言失败（`root grants 0x40 to Authenticated Users`）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：默认 `C:\` 与非系统盘根目录的真实 DACL 仍需 Windows 11 实机确认；不读 ACE 标志，根目录上非管理员的
  仅继承 GENERIC_ALL 等也按失败处理（从严）；安装树内显式设为用户可写的子目录仍不扫描（另一条发现，未在此修）。
