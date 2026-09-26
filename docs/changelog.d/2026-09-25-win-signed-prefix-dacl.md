## 2026-09-25 · Windows：签名应用目录前缀只授予仅管理员可写的安装目录
- 归属：G1（已连接时的保护边界：reviewed 直连的 WFP 规则 H）；Windows App `tono/signed_apps.rs`。
- 来源：基线 origin/main `7a09f9cd`；红分支 `wip/win-signed-prefix-dacl-20260925-red`（`255a0028`），修复分支
  `fix/win-signed-prefix-dacl-20260925`，[#633](https://github.com/raydocs/tono/pull/633)；未合 main。
- 缺陷修复：已验签的微信/钉钉/飞书见证文件只要所在目录符合官方布局尾部就获得目录前缀
  `PROCESS-PATH-REGEX`；按用户安装（`%LOCALAPPDATA%\Tencent\…`、`%APPDATA%\DingDing` 等）和默认 ACL 的非系统盘安装
  用户可写，放进前缀目录的任意程序都匹配直连规则（[#333](https://github.com/raydocs/tono/issues/333)，发现 H1-F2 Windows 变体）。
  改后：用 `GetNamedSecurityInfoW` 读安装目录及其各级父目录（到 `X:\Program Files[ (x86)]` 或盘符根为止）的所有者与 DACL，
  每级所有者须为 Administrators/SYSTEM/TrustedInstaller，且带写类权限（写/追加/建子项/删除/WRITE_DAC/WRITE_OWNER/
  GENERIC_WRITE/GENERIC_ALL）的允许 ACE（含仅继承 ACE）只属于这三者或 CREATOR OWNER，才保留前缀；
  否则（含读取出错、NULL DACL、不支持的 ACE 类型、UNC 路径）退回该已验签文件的精确正则。
- 新增/优化：无。按用户安装与默认非系统盘安装从目录前缀降为单文件精确匹配，其目录内辅助进程改走隧道（收紧，不放宽）。
- 工程与测试：读取放在 `DirectorySecuritySource` 小 trait 后，判定逻辑用假 ACL 测；新增一个 `#[test]`
  `directory_prefix_requires_an_admin_only_install_chain`（仅管理员 → 前缀；父目录用户可改 → 精确；读取出错 → 精确）。
- 验证：未在本地编译（MacBook 不是构建机）；以 `windows-ci`（`windows-2025`，Tauri crate `cargo test --locked`）为准，
  PR 提交时尚未出结果。红分支上后两种情况应按断言失败。
- 候选/发布：仅源码，无新候选。
- 剩余限制：非系统盘默认 ACL 与真实微信/钉钉/飞书安装目录（含 `WindowsApps` 包目录）的 ACL 仍需 Windows 11 实机确认；
  只查目录与父目录，不扫描显式设为用户可写的子目录；任意盘的 `Program Files` 都算停止点；发现结果按见证文件指纹缓存，
  ACL 变化而见证文件不变时需重启才生效。
