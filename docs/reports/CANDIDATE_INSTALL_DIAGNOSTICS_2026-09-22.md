# 0.0.73 候选签名与覆盖安装诊断 — 2026-09-22

范围：所有者要求继续解释 macOS 签名入口为何仍锁 0.0.72，以及 Windows
候选为何构建成功但覆盖安装失败。归属 SHIP_PLAN G3、[#273](https://github.com/raydocs/tono/issues/273)
和 [#26](https://github.com/raydocs/tono/issues/26)。本轮交付是原因与可重复诊断，
不是产品修复、签名准入变更、合并、客户发布或全仓审计。

## macOS：产品升级遗漏了独立的候选签名合同

- [52e1c8ca](https://github.com/raydocs/tono/commit/52e1c8cadd5bdbc4c0f1ab7fa1de89aa869dca85)
  在 9 月 8 日加入一次性的候选签名入口，只接纳
  `refs/heads/stability/desktop-0.0.72-20260908`。
- [4c3d952e / #224](https://github.com/raydocs/tono/commit/4c3d952eee8599301bb0b5bdfa58fed6d2ce732d)
  在 9 月 17 日把产品配置升至 0.0.73/build73；该提交的七个文件没有包含签名 workflow。
- 当前 [签名 workflow](../../.github/workflows/macos-release.yml) 的两个候选入口仍检查旧分支，
  还执行 `verify-desktop-version.py --expected 0.0.72`；产物阶段再次断言
  `CFBundleShortVersionString == 0.0.72` / `CFBundleVersion == 72`，manifest 也写旧值。
- 当前 [候选入口回归](../../tooling/scripts/tests/macos-candidate-workflow.test.rb)
  明确要求接纳旧候选分支、拒绝 main 和 release/macos 的 candidate 模式。
  它验证隔离合同，不验证合同是否已跟随产品版本更新。

Linux Orb 实际命令 `ruby tooling/scripts/tests/macos-candidate-workflow.test.rb`：
exit 0，`8 branch cases and update-authority guards passed`。
这证明旧限制仍生效，不证明 0.0.73 已签名；未触发 signing/notarization workflow、
未读取签名凭据。现有阻塞不属于已证实的 Apple 证书、notary 或 GitHub 权限故障。

必要修复：先明确可信的 0.0.73 候选来源，再同步两处准入、版本/build、manifest 和回归。
保留精确来源、签名/公证检查及候选不进入 Sparkle 发布阶段的限制；不能开放任意 PR 签名，
也不能全局把所有 `72` 替换成 `73`。

## Windows：Users 根目录被构造成驱动器相对路径

产品二进制始终来自同一 [候选构建 35691265073](https://github.com/raydocs/tono/actions/runs/35691265073)，
来源 [25e56707](https://github.com/raydocs/tono/commit/25e56707f91c3c6c69a30b4d76b46e087543c99e)。
两次诊断复用原包，没有构建新候选包；分支 push/PR 仍自动触发常规编译与测试，
那些 CI 与下面直接运行原包的证据分开记录，不能相互替代。

- 安装器 SHA-256：`fbc84460c68258585530c58f1200c52b44bfce40c51fbc2c96e23aa6acdb2d61`。
- 已安装 helper SHA-256：`84505a64e05a2917a0be8b9a17d3c6491ce9094d12f4faebcf33190415c5c062`。
- 两次诊断均核对候选 run/repository/workflow/source、产品与构建输入 Git tree、安装器 hash、
  已安装 helper hash、Core pin；仅在全新的 GitHub-hosted Windows Server 2025 管理员主机运行。
- 每次先运行原包 `/S` 新装；只调用一次原版 helper 的 `--replace-runtime`，不在失败的 NSIS 调用之后重试，
  不删除日记、不吞掉错误、不放宽保护。卸载和 DNS 前后对比均通过。

| 实际执行 | 测试工具 checkout / 变化 | 结果 |
|---|---|---|
| [原静默覆盖 35693574024 / job106635490996](https://github.com/raydocs/tono/actions/runs/35693574024/job/106635490996) | 产品来源同上；`/S` 后 `/S /UPDATE` | 新装成功，覆盖返回外层 NSIS exit2；当时无 helper 输出，不能据此单独推断内层原因。 |
| [helper 诊断 35696032923 / job106642986630](https://github.com/raydocs/tono/actions/runs/35696032923/job/106642986630) | [5447ae83](https://github.com/raydocs/tono/commit/5447ae830e515c8faeeb77b6a0f2e3914343e216)；显式使用已安装 resources 目录为 cwd | helper exit76；stderr：`tono-install: update journal gate refused replacement: The system cannot find the path specified. (os error 3)`。job 失败，保留真实非零结果。 |
| [工作目录对照 35696540552 / job106644559909](https://github.com/raydocs/tono/actions/runs/35696540552/job/106644559909) | [da59c993](https://github.com/raydocs/tono/commit/da59c993579603a2acfbadd500766851afeb1171)；只把 helper cwd 改为安装盘根目录并记录变量 | `SystemDrive=C:; helper working directory=C:\`；helper exit0，`Service, Mihomo and App replacement committed after IPC readiness.`；job 成功。 |

原生 PowerShell 命令为
`tooling/scripts/test-windows-candidate-install.ps1 -CandidateDirectory $env:CANDIDATE_DIRECTORY -DiagnoseHelper:$true`；
对照另加 `-DiagnosticDriveRoot:$true`。这不是 `/S /UPDATE` 的等价替身。
证据原件：[失败诊断 artifact](https://github.com/raydocs/tono/actions/runs/35696032923/artifacts/10679998778)、
[工作目录对照 artifact](https://github.com/raydocs/tono/actions/runs/35696540552/artifacts/10680259361)。
二者均含 summary JSON 和 helper stdout/stderr；不是安装包重新构建后的红绿。

### 原因及现有测试漏点

[record_install_started_for_installed_app](../../apps/windows/service/src/bin/install_service.rs)
用 `PathBuf::from(SystemDrive).join("Users")` 构造枚举根目录。
Windows 的 `SystemDrive` 为 `C:`，这里形成 `C:Users`，不是 `C:\Users`。
按照 [Windows 路径规则](https://learn.microsoft.com/en-us/dotnet/standard/io/file-path-formats)，
它相对于该驱动器的工作目录；在安装目录下，枚举的是安装目录内不存在的 Users。
在盘根目录下，它才碰巧指向真实用户目录，解释了同一 helper 的工作目录对照结果。

这个拼接已经存在于
[3451ce5c / #189](https://github.com/raydocs/tono/commit/3451ce5c041be60901cbbdcd7b91effd7e8c6e1f)
之前；#189 正确地将目录枚举失败从忽略改成拒绝，因而暴露了既有错误。
调用链是 Users `read_dir` 失败 → helper journal gate exit76 → NSIS Abort → 外层 exit2。
本次不是 journal JSON 内容、认证 handoff 身份或某个用户目录权限拒绝的证据。

现有 `incomplete_profile_discovery_cannot_authorize_an_installer_handoff` 回归直接传入
临时 Users 路径，验证错误传播，却没有经过 `SystemDrive` 的生产路径构造。
编译成功和这些回归通过不能覆盖这个原生调用边界；正常构建 CI 也没有执行真实覆盖安装。

必要修复：在 helper 内正确构造并校验绝对 Users 根目录，增加经过生产路径构造的 Windows
回归；保留枚举失败拒绝、exit76 不重试及现有保护。不能以强制调用者切换至盘根目录作为
产品修复。随后用修复源码构建新候选，重新运行原始 `/S` → `/S /UPDATE` → uninstall。

## 交付与边界

- [诊断 PR #275](https://github.com/raydocs/tono/pull/275)，分支 `diag/g3-installer-helper-20260922`。
  未修改产品源代码、依赖、签名权限或客户更新源。仅有默认关闭、固定旧包身份的临时诊断模式。
- 最终工具代码的本地 `node --test tooling/scripts/tests/windows-ci-paths.test.cjs`：7 passed / 0 failed；
  staged whitespace check exit0。静态合同检查不冒充 PowerShell 或原生安装。
- 对照 JSON 仍明确记录 `diagnosticOnly=true`、`sameVersionRepair=false`、
  `physicalUpgradeQualified=false`；helper 成功不能改写原始 NSIS 失败，也不是 Windows 11 或
  已连接/Protected Offline 升级、真实 WFP/DNS 流量保护、认证 handoff 的验收。
- 两个原因已定位，两个产品/签名修复尚未交付。#26/#273 保持打开；原包仍不能作为已验证的
  替换安装版本交给测试者。没有新合并、签名、部署、更新渠道推广或后台跟进 schedule。
