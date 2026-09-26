## 2026-09-23 · Windows Service 保护路由只接受已安装的 Tono App

- **归属/来源**：G1 保护不得放宽（内部审查 H2-F3，[#351](https://github.com/raydocs/tono/issues/351)
  第 1 部分）；影响 Windows Service（`apps/windows/service`）。基线 main 244075f2，分支
  `fix/win-service-app-image-20260923`；提交时未合 main。第三轮审查结论“需返工”，本条已按其
  三个问题修改。**合并前置条件**：在 Win11 验收机的默认安装上运行
  `icacls "C:\Program Files\Tono"`（并记录所有者，如 `(Get-Acl "C:\Program Files\Tono").Owner`），
  确认只有 SYSTEM / Administrators / TrustedInstaller 有写权限、所有者是其中之一；拿到该证据前不得合并。
- **缺陷修复**：
  - Service 只证明调用方是 owner 用户（pipe PID 的 SID + `%APPDATA%` token），同用户任意进程都
    能调用 Release、RestoreDns、StartClash 等改变 WFP/DNS/Core 的路由。现在
    `enter_owner_lifecycle` 在取生命周期锁之前要求对端是已注册安装目录下的 `Tono.exe`（复用更新
    路由的 `update::app_image`，含安装树 ACL 校验）。覆盖所有进入 owner lifecycle 的路由（含
    StopClash、会话路由、GetClashLogs、OwnerGoodbye）；只读状态路由不变。卸载/修复走管理员
    `--emergency-disarm` 与 SCM，不经管道。
  - 审查返工 1：安装树 ACL 校验原先只信任 SYSTEM 与 Administrators，而 `C:\Program Files` 下新建
    目录默认继承 `NT SERVICE\TrustedInstaller:(I)(F)`，安装器也不收紧 ACL，按源码推断标准安装上
    该校验必然失败（Connect/Disconnect/Release 全被拒）。现把 TrustedInstaller
    （S-1-5-80-956008885-…-2271478464）列为可信的所有者/写入者；CREATOR OWNER 在 Program Files
    上只以 inherit-only 出现（已跳过），继承时替换成创建者即对象所有者，而所有者本就必须可信，
    故不另加。Users、Authenticated Users、Everyone、owner 用户等非管理主体有写位仍判不可信。
    此改动同样作用于更新路由的 `app_image`。
  - 审查返工 2：只有“对端映像不是已注册的 `Tono.exe`”返回 401 `UnauthorizedOwner`；其余无法
    完成证明的情况（注册表/ACL/文件读取失败、安装树文件被占用、树过大、对端 PID 缺失、阻塞任务
    未完成）返回新错误码 `AppIdentityUnproven`（1016，HTTP 503），消息提示重试，若持续则修复 Tono
    或以管理员身份运行 `tono-service.exe --emergency-disarm`（App 把该消息直接显示给用户）。
    Release/Disconnect 在此情况下**仍拒绝**，不放行：同用户普通进程可以故意让证明失败（例如以
    不共享读的方式打开安装树内文件），若放行等于重新打开本修复要关闭的旁路；出口是重试与已有的
    管理员 `--emergency-disarm`。1013–1015 在 main 上已被 `StaleReleaseEpoch`、`ProtectionHeldByAnotherUser`、
    `RemoteSessionConnectRefused` 占用，2026-09-25 合入 main 时由 1014 改号为 1016（App 已把 1014 映射为
    “另一用户正在使用保护”）。
- **新增/优化**：无。
- **工程与测试**：
  - `lifecycle_entry_refuses_when_the_app_image_proof_cannot_complete`（`server/owner_lifecycle_tests.rs`，
    Windows `#[tokio::test]`，替换原 `a_process_of_the_owner_user_that_is_not_the_installed_app_is_refused`）：
    lifecycle `test` feature 下映像证明改为可注入（默认放行，测试进程本就不是 App），本测试注入
    “无法完成”的证明，经 `enter_owner_lifecycle` 断言返回 503。删掉 `enter_owner_lifecycle` 里那次
    调用，入口会继续到 `Continue`，测试失败（审查指出原测试在删调用后仍绿）。
  - `default_program_files_inherited_acl_is_trusted_and_user_write_is_not`（`update/security.rs`）：
    用 SDDL 构造 Program Files 默认继承 ACL（含 TrustedInstaller:(I)(F)），断言被接受，再追加
    Users 修改权限断言被拒。在修改前的分支上第一条断言失败（TrustedInstaller 的有效 ACE 带写位
    被判“ordinary users can modify”）。该 SDDL 是按 Windows 默认 ACL 建的模型，尚未从设备读取。
- **验证**：本机（MacBook）按 AGENTS.md 未运行 cargo，本机未编译；编译与测试委托本 PR 的
  GitHub-hosted `windows-2025` CI。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：未实机验证；需上述 `icacls` 证据后才能合并，若设备 ACL 与模型不符（例如所有者是
  安装用户而非 Administrators），仍会全部拒绝，需在本变更内再修。Windows 未做 Authenticode，绑定的是
  “管理员保护的已注册安装目录中的 Tono.exe”，与更新路由同等强度，不等于 macOS 代码签名。开发构建
  （`pnpm dev` 从 `target\` 运行，`dev-service.mjs` 不带 `test` feature）与
  `tono-service-integration-driver` 的 start/stop/logs 对已安装或开发版 Service 的生命周期路由将被
  拒（机器上有已注册安装时 401，没有时 503），没有替代的开发路径，需 owner 明确接受。App 端未对
  1016 做专门重试，只显示 Service 的消息。每次进入生命周期都会对 Tono.exe 做摘要并遍历安装树，耗时未实测，也未按
  (pid, started_at) 缓存。StartClash 配置的 Service 端校验在 #351 第 2 部分单独 PR。

- 续记 2026-09-26：合入 main（#300/#305/#632/#633 之后）解决 `service/src/core/update.rs` 的 `pub use security::{…}` 冲突（取两边并集：`NotRegisteredApp` + `record_installed_version`）；本条从 INTERNAL_CHANGELOG.md 移为分片（#631 规则）。合并前置条件不变。
