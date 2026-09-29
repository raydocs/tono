## 2026-09-29 · macOS helper brick 修复：启动屏障看意图、hosts 不再挡释放、释放装回被挤掉的主规则集
- 归属：SHIP_PLAN §2 第 10 条冻结期修复（brick 审计，G2 macOS 保护与恢复）。影响 helper `UpdateExecutor.swift`、
  `main.swift`、`KillSwitchManager.swift`、`KillSwitchPF.swift`、`UpdateRuntime.swift`、`ProtectedDNSManager.swift`，
  自测 `KillSwitchTests.swift`、`UpdateTests.swift`，helper 协议 4.50.0 → 4.51.0。发现 BRICK-M1、M2、M3、M4、M6（本 PR），
  BRICK-M8–M12（记为 open）。计划 PLAN-mac-brick-lowrisk（plan review 5d673af2、修订轮 eccc7297 通过），Jev-Decision `18910b31`。
- 来源：基线 origin/main `c0e7758e`；分支 `fix/macos-brick-helper-20260929`；红提交（仅测试与改前行为的接缝）`1065069b`；
  修复提交 `72c25123`（M2、M6）、`640b46c6`（M1、M3、M4）；记录提交为本条所在提交。PR [#679](https://github.com/raydocs/tono/pull/679)，
  未合 main。
- 缺陷修复：
  - BRICK-M1 第 1 部分：更新执行器启动失败（`/Library` 或 `Application Support` 组/其他用户可写、账本读不出或 schema 更新）时，
    改前不看意图就装紧急屏障，daemon 在建 socket 前退出，从没开保护的 Mac 每次开机断网。改后 `startup` 只在
    `KillSwitchManager.stateFileExists`（保存了意图）时装屏障；store 打开后的错误在更新锁内判定并安装，store 或锁打不开时
    在外层判定，两处不会都装（`secured`）；`.stopping` 原样放行、不装屏障。
  - BRICK-M2：`/etc/hosts` 不能安全改写时，改前 arm 存了意图后失败，status/supervisor 修复/启动恢复走紧急分支，disarm 在 PF
    flush 前删 hosts 条目，所有释放路径都失败。改后 arm、status、supervisor 修复、启动恢复经 `pinHostsIfUsable` 尽力写入
    （跳过时记一行 stderr）；`disarm()` 走 `releaseSequence`：占位规则 → flush → 确认锚点为空 → 删意图 → 删 hosts 条目
    （失败只记 stderr）→ 装回被挤掉的主规则集 → 释放 PF 引用，删意图之后不再抛错。`secureRead` 加 `O_NONBLOCK`，
    `/etc/hosts` 是 FIFO 时 open 立即返回并被原有的普通文件检查拒绝。不安全文件从不改写、不备份。临时决定见
    [DECISIONS](../DECISIONS.md) 2026-09-29 hosts 条目。
  - BRICK-M3：helper 启动时的删除检查把任何没有可读 `Contents/Info.plist` 的 `*.app`（iPhone/iPad 包装应用）算作 Tono。
    改后 `<entry>/Contents` 的 lstat 得 ENOENT/ENOTDIR 就跳过；其余「有疑问算存在」的返回不变。
  - BRICK-M4 观察一半：原生更新的 `observe()`/`prepare()` 改前遇到任一 loopback 代理、没有 Proxies 协议的服务或含
    `127.0.0.1` 的 DNS 就拒绝。改后代理只在某个 loopback 条目的端口可能是 Core 的 mixed 入站端口（runtime config 读不出、
    条目没有端口也算）时拒绝，没有 Proxies 协议或没有配置的服务不再拒绝（live 键照读）；DNS 只在正好是 `[127.0.0.1]`
    时拒绝（含 Global 键）。拒绝文案不变。
  - BRICK-M6：紧急屏障退到把 `pf.tono-main.conf` 当主规则集加载后，改前 disarm/reset/移除释放都不装回 `/etc/pf.conf`。改后
    释放中若标记文件在、且 `/etc/pf.conf` 含 Tono 的两行挂钩，就 `pfctl -f /etc/pf.conf`，状态 0 才删标记；从不写
    `/etc/pf.conf`、不用 `.tono-backup`。reset 与移除释放经 `disarm` 走到这里。
- 新增/优化：无。
- 工程与测试：
  - lifecycle 自测新增 `release-survives-unusable-hosts`（L1：记录顺序、hosts 步骤抛错时仍返回）与
    `displaced-main-restored-only-through-a-hooked-pf-conf`（L2：四种情况，另断言每次重载的参数都是 `/etc/pf.conf`）。
  - update 自测新增 `startup-barrier-only-with-intent-decided-under-the-update-lock`（U1）、
    `helper-start-release-looks-past-iphone-app-wrappers`（U2）、`update-verification-refuses-only-tono-leftovers`（U3），
    总数 13 → 16；原启动用例两次调用传 `protectionWanted: { true }`，断言未改。
  - 接缝：`KillSwitchManager.releaseSequence`、`KillSwitchPF.restoreDisplacedMainRuleset`、`UpdateExecutor.startup` 的
    `protectionWanted`、`UpdateRuntime.coreProxyPorts`/`mayBeTonoProxy`、`ProtectedDNSManager.isStoppedTonoResolver`。
    `restoreDisplacedMainRuleset` 的 `reload` 取路径参数（`(String) throws -> HelperCommandResult`，总以 `/etc/pf.conf` 调用），
    计划 §1.5 写的是无参闭包，§1.6 要求记录重载参数，以后者为准。
  - 协议 4.51.0，`CONTRACT.sha256` 为 `4.51.0 32d17131…`（按 `build-core-helper.sh` 的清单与管道在不编译的情况下算出）。
  - 没有单元测试覆盖（需真实 PF 或 SystemConfiguration）：arm/status/supervisor/restore 四处 hosts 调用（靠 grep）；
    `disarm` 里的真实闭包（靠下面的临时 CI 早检）；外层无锁的屏障路径（靠 grep）；`verifyProxyRestored` 的
    SystemConfiguration 接线（只能实机）。
  - 临时早检（一次性分支 `fix/macos-brick-helper-20260929-early`，已删，从未合并）：在 CI runner 上以 root 跑
    `--emergency-disarm` 三种情况。第一版把标记文件用非 root 的 `[ -e ]` 检查（目录 0700 属 root，永远读成 removed），
    改为 `sudo test -e` 并加「运行前标记是否存在」一行后重跑；第一版的 (c) 标记结果作废。
- 验证：本机只做 `swiftc -typecheck`（helper 清单，arm64-apple-macosx26.3），每个提交后通过；未本机编译或运行自测。
  - 红 R1 `1065069b`：macOS CI [push 36543887824](https://github.com/raydocs/tono/actions/runs/36543887824) 失败，
    `privileged-tests` 在 `--lifecycle-self-test` 打印
    `lifecycle self-test failed: release-survives-unusable-hosts, displaced-main-restored-only-through-a-hooked-pf-conf`；
    helper 构建与版本门通过，不是编译错误；build、policy-tests、sing-box-input 通过。
  - 红 R2 `72c25123`：macOS CI [push 36544794489](https://github.com/raydocs/tono/actions/runs/36544794489) 失败，
    lifecycle 通过（打印 `tono: hosts pins kept after release: A root-owned file is unsafe.` 等预期 stderr），
    `--update-self-test` 打印 `FAIL update:` 三条：U1 `invalid("A startup failure without saved intent installed the emergency block")`、
    U2 `invalid("An iPhone app wrapper kept a removed Tono's installation")`、U3 `invalid("The Core's mixed port was not read")`，
    `13 passed, 3 failed`。
  - 修复 `640b46c6`：macOS CI [push 36545710347](https://github.com/raydocs/tono/actions/runs/36545710347) 通过（四个作业全绿；
    update 自测 `16 passed, 0 failed`，lifecycle、core lifecycle、staging 自测通过）。记录提交（头）的 push 与 PR 运行见 PR。
  - 早检，红（`1065069b` + 早检步骤，[run 36544454256](https://github.com/raydocs/tono/actions/runs/36544454256)，
    `privileged-tests` 作业完成；该运行其余作业在推修复合并后被取消）：PF 前后 `Status: Disabled`，Tono 目录原本不存在。
    (a) 基线 `exit 0`（「Tono network protection is disarmed.」）；(b) `/etc/hosts` 0666：`exit 1`（「Tono emergency recovery
    failed; PF remains fail-closed.」），hosts sha256 未变，模式 666 → 666；(c) `/etc/pf.conf` 追加 Tono 挂钩后
    `pfctl -nf` `exit 0`，标记运行前 present，替换加载 `exit 0`、标签 1 行，运行后 `exit 0`、标记 kept、pf.conf sha256 未变、
    标签仍 1 行、`com.apple` 锚点 0 行。
  - 早检，修复（`640b46c6` 合入早检分支为 `59cd9983`，[run 36545228928](https://github.com/raydocs/tono/actions/runs/36545228928)，
    `privileged-tests` 通过，同一作业的 update 自测 `16 passed, 0 failed`）：PF 前后 `Status: Disabled`，Tono 目录原本不存在。
    (a) `exit 0`；(b) `exit 0`（stderr `tono: hosts pins kept after release: A root-owned file is unsafe.`，随后「Tono network
    protection is disarmed.」），hosts sha256 未变，模式 666 → 666；(c) `pfctl -nf` `exit 0`，标记运行前 present，替换加载
    `exit 0`、标签 1 行，运行后 `exit 0`、标记 removed、pf.conf sha256 未变、标签 0 行、`com.apple` 锚点 2 行
    （`scrub-anchor "com.apple/*"`、`anchor "com.apple/*"`，另有 `anchor "tono.killswitch"`）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未实机验证（任何一项）。BRICK-M1 与 M4 仍 open（本 PR 是第 1 部分与观察一半）：保存了意图而 store 不可用的
  Mac 仍被拦、紧急命令仍需 store；安装守卫未改；更高 schema 的回滚构建仍无法启动；启动失败不做移除释放；重启后任何
  loopback 代理仍挡更新；别家正好 `[127.0.0.1]` 的 DNS 仍挡；早先会话或旧版本在别的端口留下的 Tono 代理不归因。
  BRICK-M2：不安全 hosts 里的旧 Tono 条目留着，保护期间钉住的名字可能解析不了，清理失败只写 stderr（daemon stderr 是
  /dev/null）。BRICK-M3：有 `Contents` 但 Info.plist 读不出的包仍算 Tono，删除只在启动时检查（BRICK-M11）。BRICK-M6：
  `/etc/pf.conf` 没有 Tono 挂钩或加载失败时仍停在替换状态，动态 `com.apple/*` 保留未实机验证。BRICK-M8–M12 未修。
  jev-route 合并前审查未在本条内运行。
