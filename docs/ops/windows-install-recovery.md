# Windows 安装被阻止：保留数据的取证与恢复

归属：SHIP_PLAN G1 / §2 item 10。适用于 `TONO_INSTALL_TONO_ADAPTER_PRESENT`
及“无法安全确认现有版本”。**这不是跳过门禁的操作手册，也不表示客户已恢复。**
本次源码交付包含卸载重试/记录一致性修复，不只是修改弹窗；未合并、未发布新包。

## 本次客户的时间线（2026-10-17 更正）

客户说“32 可重新安装；卸载后装 76 不行”。目前三条命令看到的 0.0.32 卸载项、
Tono.exe/uninstall.exe 及 Up 的 WinTUN 都是**重新安装 32 后**采集的，不是卸载残留
的证据。程序文件存在不证明完整安装，Up 不证明实际流量已通，也不证明旧卸载留活 Core。
“76”尚未绑定完整文件名/哈希；不能直接认定为仓库某个候选标签。

先保留当前可用的旧版，不反复拆装。若客户愿意继续迁移，先在 32 正常断开、确认普通
网络可用、完全退出托盘，再正常卸载且保留数据；关掉卸载窗口，**在重装任何版本之前**
采集下面三条和 `sc.exe query TonoService`。卸载失败则不继续。无需寻找已不存在的日志。

已反证的假设：当前安装器及仓库可找到的 0.0.32 源码都**写入带引号的 InstallLocation，
但版本检测不读取它**。Program Files 路径固定，旧位置检查另读制造商产品项默认值。
原生安装根验证也会去掉外层引号。
Core 的 PE ProductVersion 为空也不参与版本判断。当前完整的 0.0.32 产品记录应通过
SemVer 检测；它不能解释之前卸载后的“版本不明”。不要为了排查去改注册表值。

## 可以直接发给客户

找不到 `C:\ProgramData\Tono\logs` 没关系，不需要创建目录。请勿反复重启、删除网卡/
驱动/注册表、改网卡名称、重置网络或删除 Tono 数据。

1. 若 Tono 可打开，请正常“断开”，确认成功后退出。若其他 VPN 正在运行，只用它自身的
   断开/退出功能；不要卸载其他软件的网卡。
2. 若 Windows“已安装的应用”中有 Tono，且原卸载程序可用，可以正常卸载，**不要勾选
   “删除应用数据”**。卸载也报错、卸载器缺失或没有此条目，就停止，不使用强制清理。
   新卸载器也可能被同一个网卡门禁挡住；这时不能靠继续卸载解套。
3. 请提供两次安装包的完整文件名、弹窗先后顺序、期间是否卸载/清理过，以及下面三条
   PowerShell 只读命令的输出截图。普通 PowerShell 即可；报错也保留，不需要管理员写操作。

```powershell
Get-NetAdapter -IncludeHidden -Name Tono | Format-List Name,InterfaceDescription,InterfaceGuid,ifIndex,Status,PnPDeviceID
reg.exe query 'HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Tono' /reg:64
Get-Item 'C:\Program Files\Tono\Tono.exe','C:\Program Files\Tono\tono-core.exe','C:\Program Files\Tono\verge-mihomo.exe','C:\Program Files\Tono\uninstall.exe' -ErrorAction Continue | Select-Object Name,@{n='Version';e={$_.VersionInfo.ProductVersion}}
```

这些输出不需要日志目录，不创建目录、不运行安装助手、不修改网络或注册表。
找不到文件/注册表项不是命令失败需要“修好”，而是支持需要的事实。不要把配置、凭据或
整个 ProgramData/AppData 上传到公开 Issue。若需备份应用数据，在程序退出后将自己账户的
`%APPDATA%\com.raydocs.tono` 和 `%LOCALAPPDATA%\com.raydocs.tono`（存在者）复制到本机
私有备份位置，**保留原件、不外传**；这不是删除/还原 SYSTEM 保护状态的许可。

## 支持人员：最少的后续只读核对

仅在前三条不能定位时再请求，保留每条的“找不到”或“拒绝访问”结果：

```powershell
reg.exe query 'HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Tono' /reg:32
reg.exe query 'HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Tono' /reg:64
sc.exe query TonoService
sc.exe qc TonoService
Get-CimInstance Win32_NetworkAdapter -Filter "NetConnectionID='Tono'" | Format-List NetConnectionID,GUID,PNPDeviceID,ServiceName,NetEnabled,ConfigManagerErrorCode
$env:ProgramData
```

若客户愿意补充安装包身份，用 `Get-FileHash -Algorithm SHA256 -LiteralPath '实际安装包路径'`。
相同版本号不保证同一包。文件版本与注册表字符串是诊断线索，不是可信安装/降级授权。
需要 PnP/驱动供应商及安装来源才能判断设备归属；`Tono`/`Meta Tunnel`/Down 本身都不够。
不得执行注册表 `UninstallString` 中未经核验的任意命令。

只有确认原卸载器可用时才走正常保留数据卸载；不存在可运行的旧安装时，请支持根据上述
设备身份、SCM、文件与记录证据制定定点恢复，而不是让客户盲删残留目录/卸载项。
当前没有证据支持对此客户执行设备删除或强制文件/注册表清理，也没有保证解锁的单条命令。
`recover-windows-tono-uninstall.ps1` 是另一个 result=3 的主动释放/卸载工具，不是本场景的
只读取证命令，不应直接发给本客户运行。

## 当前代码如何拒绝（以及重启为什么不保证有效）

- `service/src/core/update/security.rs` 用 `GetIfTable2` 枚举，精确、不区分 ASCII 大小写
  匹配别名 Tono；仅 `IfOperStatusNotPresent=6` 被忽略。客户截图 `operStatus=2` 是 Down，
  不是“不存在”；adminStatus=1 也不能证明这是孤儿。枚举失败不视为不存在。
- `update.rs::manual_core_absent` 先查记录的 Core 身份再查网卡。已有清理按进程身份/
  已安装映像路径停 Core，不按网卡名字删除设备。持久设备或其他程序重新创建的设备
  不会因为重启必然消失；哪个原因适用于本客户尚未证实。
- NSIS `.onInit` 先过原生网络/生命周期门禁，再 `DetectExistingInstall`。在同一个当前
  安装包的一次执行中，87 在版本检测之前。多张图顺序及包身份未知，不能当作同一执行。
- 版本检测读产品专属卸载项的 DisplayName / UninstallString / DisplayVersion；字段
  不完整/名称不符、SemVer 无效、比较器异常都拒绝。没有有效产品记录但目录仍有
  Tono.exe / tono-core.exe / verge-mihomo.exe 也拒绝，不会猜版本或覆盖。
- 这些情况以前全显示“检测到现有安装”，不能证明存在完整、可卸载的旧程序。历史
  0.0.32–0.0.34 卸载遗留程序文件是已有记录的可能路径，**未证实本客户卸载后有此残留**。

仓库 `a4fb0d9f8^` 的 package.json 为 0.0.32，其 NSIS `un.onInit` 没有新版原生门禁；
卸载在 `RemoveVergeService` 后用普通 `Delete` 删除 App/生成列表中的 Core，未按删除
结果阻止后续 `DeleteRegKey`。新版先检查 Core/网卡，再拒绝“记录消失但二进制还在”。
因此旧版能重装不代表新版门禁误报，正常卸载路径也可能留下二进制；这仍是源码路径，
不是在客户的 32/76 实物上重放成功。已有 [0.0.32 兼容限制](../findings.d/WIN-0032-0034-INPLACE-UPGRADE.md)
不能替代本客户卸载后的取证。禁止用新版直接覆盖升级试错。

新增截图代码：`TONO_INSTALL_RECORD_INCOMPLETE`（记录不完整/产品名不符）、
`TONO_INSTALL_VERSION_INVALID`（版本不可解析）、`TONO_INSTALL_VERSION_COMPARE_FAILED`
（比较异常）、`TONO_INSTALL_FILES_WITHOUT_RECORD`（无有效记录但程序文件存在）。
所有分支仍返回 1638、退出并按既有规则交还租约，不删除应用数据。

## 本次实际修复与未自动化的恢复

- 提前拒绝旧布局：历史提交
  [55f31a2b](https://github.com/raydocs/tono/commit/55f31a2bfc830e773efd910ac4f1a15be473d30f)
  在 0.0.35 将 `verge-mihomo` 改名为 `tono-core`。完整、可解析的旧版记录不再直接进入
  当前替换事务，而是在覆盖 GUI/helper/卸载器前报 `TONO_INSTALL_LEGACY_LAYOUT`。
  **同时存在 tono-core.exe 和 verge-mihomo.exe 也不能把 0.0.32 认成新版布局**；本客户
  的两文件存在仍是重装后的事实，不证明它们各自来源。当前版缺失替换目标时另报
  `TONO_INSTALL_INCOMPLETE_PAYLOAD`，可先重试保留下来的卸载器。继续保留已有的、单独
  门禁和用户确认的孤儿 WFP 恢复路径；不扩展其授权，不自动运行旧 UninstallString。
- 新卸载器自带同包 helper/pin，不依赖上一次可能已删除的 `resources`。在任何门禁/删除
  之前，新增只读 `--verify-uninstall-root`：限定实际 Program Files\Tono，检查 ACL 和
  全树链接/重解析点；`_?=`/拷贝卸载器不能把清理改向其他目录。验证不要求卸载项仍在。
- helper 已证明网络安全但返回 result 2（SCM/二进制/恢复任务未清完）时，**新卸载器**
  返回 1603，保留程序文件、记录和卸载入口，显示 `TONO_UNINSTALL_CLEANUP_INCOMPLETE`。
  安装修复仍可接管该安全状态；result 3/未知仍拒绝，result 4 的既有 DNS 提示不变。
- 新卸载器逐项检查 App/Core/历史 Core/资源文件删除结果；失败返回 1603 和
  `TONO_UNINSTALL_FILE_RETAINED`，列出具体文件，保留 ARP/uninstall.exe 并交还自己的
  租约。不要把排队等待重启删除当作即时成功。即使前面文件已删除、安装 helper 也已
  缺失，仍可在解除占用后重试这个自带 helper 的卸载器。不选删除数据就不删除账户数据。
- 这些改动**不能追溯更新客户手中 0.0.32 的卸载程序**。没有记录但文件仍在仍然拒绝，
  不能仅凭文件名/空 PE 版本猜版本并覆盖；Up/Down 仍拒绝，NotPresent 才忽略。
  未加入设备删除、注册表清理、全局网络重置或删除数据功能。当前缺乏客户卸载后设备
  归属/持有者证据，不能安全承诺一键清掉其 WinTUN；这部分保留为待实机定位的阻塞。

## 日志不存在时如何解释

- `core/update/gate.rs::GateReport::for_machine` 仅在私有 SYSTEM/Administrators 状态根
  验证/准备成功时选取 `%ProgramData%\Tono\logs\install-gate.log`。`record` 尝试创建
  logs 并追加；ACL/IO/文件分享或非普通单链接文件检查失败时可无日志，门禁结果不变。
- helper 拒绝时把首行原因和**成功写入的日志位置**放在 NSIS 私有插件目录的两行原因文件。
  写日志失败时第二行是 `(the install-gate log could not be written)`；原因文件自身也可能
  写失败。成功门禁会尝试记录 OK，后续 NSIS 版本拒绝不写入这个原生门禁日志。
- 早期实现曾有 TEMP 文件日志，后因提权写入用户可控制目录的安全问题删除。不要恢复该
  降级路径。现行 NSIS 的原因文件缺失/第二行空时曾自行拼默认日志路径，此次改为明确
  日志位置不可用；**这条缺陷未证实是本客户第一图的来源**（第一图有详细原因行）。
- 当前 helper 若确实返回了日志路径，意味着当时追加成功；后来找不到不证明当时没写过。
  先核对包身份、ProgramData 实际值及期间卸载/清理，不把目录不存在直接归因为权限。

## 验证与候选包（仅测试，不是发布）

Linux 的 `node --test apps/windows/app/scripts/windows-packaging.test.mjs` 是模板/打包契约
检查，不是 Windows 安装执行。原有 Windows Rust 回归已覆盖不可写日志仍保留拒绝码、
原因行且不另写 TEMP 日志；本次扩展网卡回归覆盖确切 Tono 的 Up、Down 和 NotPresent。
现有 `test-windows-candidate-install.ps1` 已增加 **32 布局 fixture**（含带引号记录和额外
tono-core）、无卸载项文件拒绝、helper 清理 result 2、锁定历史 Core 造成部分删除、
删去已安装 helper 后重试、再次安装、账户数据哨兵保留和错误 `_?=` 目录拒绝。
它只允许一次性 GitHub-hosted Windows 管理员 runner，不能给客户机器运行。

尚需执行：Windows 编译/NSIS 对话框渲染/上述 smoke；真实、已核对哈希的 0.0.32 正常
安装→断开→保留数据卸载→新候选安装；重启前后设备 Up/Down/NotPresent（以及其他软件的
同名设备）实机验证；无原因文件/空日志行/不可写日志的可见提示。**fixture 不等于旧包实测。**
合并前还需按 AGENTS 做精确头部 SHA 的高风险独立审查；本轮未合并，未把审查当作通过。

维护者在确认待测分支/SHA 后可运行现有的**不发布**候选 workflow：

```sh
gh workflow run windows-candidate.yml --repo raydocs/tono --ref amp/windows-install-refusal-diagnostics
# 从该分支的候选运行页取得成功的 RUN_ID 和 headSha，核对等于待测提交；不要选“最新版”猜测。
gh run view RUN_ID --repo raydocs/tono --json headSha,conclusion,url
gh run download RUN_ID --repo raydocs/tono --name tono-windows-0.0.76-candidate-SOURCE_SHA --dir ./tono-install-candidate
gh workflow run windows-installer-smoke.yml --repo raydocs/tono --ref amp/windows-install-refusal-diagnostics -f candidate_run_id=RUN_ID
```

RUN_ID / SOURCE_SHA 需替换为该次真实结果；smoke 会校验候选与脚本的源码树一致。
包内 `candidate-manifest.json` 记录 source、每个文件 SHA-256 及 `candidateOnly:true`、
`releaseAccepted:false`、`updaterSigned:false`、`authenticodeSigned:false`。先通过隔离
Windows 验证和安全审查，再由支持与客户约定保留数据验证；不要让客户关闭防护绕过签名
警告。此命令不更新客户源、不创建 Release/tag；本次尚未触发构建或取得新包/哈希。
没有客户卸载后的输出和 Windows 安装实测，不能声称客户根因确认、候选可发布或已恢复。
