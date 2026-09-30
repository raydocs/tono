## 2026-09-30 · macOS 开机不再从规则文件装入阻断，启动放行
- 归属：SHIP_PLAN §2 第 10 条（装上会坏：杀开关在重启/安全模式后仍断网）。macOS helper。
- 来源：基线 main `d2363002`；分支 `cursor/fix-macos-boot-anchor-581a`；[#701](https://github.com/raydocs/tono/pull/701)。尚未合 main。
- 缺陷修复：
  - BRICK-M9：`/etc/pf.conf` 的 Tono 段改为只声明 `anchor "tono.killswitch"`。`com.apple.pfctl` 在每次开机（含安全模式）加载该文件，不再打开 Application Support 里的规则文件，因此不会在 helper 未运行时装入 `block drop out quick all`，也不会在规则文件被删掉或卡住时拖住这次主规则集加载。helper 要强制执行时，用一次性根文件做同一次 `pfctl -f`，副本里才有 `load anchor from`，避免 PF 已经启用时先把子锚点清空。写规则文件之前先改挂钩；挂钩仍会加载规则文件时，紧急屏障只把规则装进内存，不把新的阻断写进那个会被开机加载的文件。
  - 开机、helper 重启、启动失败、更新账本损坏：不再重新武装，也不装紧急全阻断。Core 未在运行时立即释放已保存的杀开关；空闲循环里 Core 连续约 30 秒未运行则再释放一次。Core 仍在运行时，监督按已保存规则重装，避免连接中泄漏；这次重装失败不再改装全阻断。
  - MAC-BOOT-DNS-ORPHAN：Core 已停且 DNS 快照还在时恢复解析，包括保护意图还在、PF 未生效的情况。没有快照则不改别人的 loopback DNS。
  - `--emergency-disarm`：DNS 恢复失败仍释放 PF。
- 新增/优化：无。连接期间、Core 仍在运行时的阻断不放宽。没有用户显式的严格杀开关开关；不按 BRICK-M10 单独看 `kern.safeboot`（安全模式本来就不启动这个 LaunchDaemon）。
- 工程与测试：helper `4.52.1` → `4.52.2`（main 的 4.52.1 是 PF 持有令牌；本分支在其上加一号）。`--self-test` 检查磁盘挂钩不含 load 行、内核副本含且仅含一行、非法路径拒绝、看门狗在第 3 次 Core 停止检查才放行、DNS 在 Core 已停且有快照时恢复。账本损坏的启动测试改为断言不装屏障，并仍断言意图读取发生在更新锁内。`CONTRACT.sha256` 随源码重算。无新 XCTest（行为在 helper 自测）。
- 验证：Linux 云代理无 Swift、无 PF。未编译、未跑 `--self-test`。hosted macOS CI（`macos-ci.yml` 的 helper self-test 与 lifecycle self-test）待精确 head。不是实机验证。
- 候选/发布：仅源码，无新候选。
- 剩余限制：见该 PR 正文的手工清单与未修项。已写入旧 `load anchor from` 的机器，要等这个 helper 正常开机跑过一次才改写挂钩；在那之前安全模式仍会加载旧规则。安全模式里留下的 `127.0.0.1` DNS 不能靠本进程清掉。helper 进程自身卡在不可中断睡眠时，进程内看门狗不会跑。Windows 的开机/损坏状态仍会装 Permanent 屏障，本条目不改。

### 手工恢复（代码不能覆盖的已经坏掉的机器）

安全模式或恢复系统里的终端，不依赖 Tono 的 LaunchDaemon：

```sh
sudo pfctl -a tono.killswitch -F all
sudo pfctl -d
```

若 `/etc/pf.conf` 里仍有 `# BEGIN TONO KILL SWITCH` 与 `load anchor "tono.killswitch" from`，删掉 BEGIN 与 END 两行之间的内容（含这两行标记），然后：

```sh
sudo pfctl -f /etc/pf.conf
sudo pfctl -d
```

DNS 仍是 `127.0.0.1` 时，对每个在用的服务：

```sh
networksetup -listallnetworkservices
sudo networksetup -setdnsservers "Wi-Fi" Empty
```

产品内命令仍是支持页的 `sudo /Library/PrivilegedHelperTools/tono-core-helper --emergency-reset`。更新账本损坏时该命令会拒绝，那是 #691 的范围，本 PR 不改它。上面的 pfctl / networksetup 不读账本。
