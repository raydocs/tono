# 一键“恢复正常网络”测试清单（测试版，2026-10-11）

给知情测试用户用。被测的是 [IMPLEMENTATION.md](IMPLEMENTATION.md) 里的抢占式恢复：恢复由独立的解除组件执行，不等旧任务；只有逐项读回干净且稳定时才显示“已恢复”。

**所有项目都还没有在真机上跑过。** 每一项的结果都按真实情况记录：通过、失败，或现象不清（例如没复现出卡住）。没有复现出问题不等于证明没有问题，不能写成“全部通过”。

## 0. 测试包（2026-10-12）

- 来源：分支 `stability/restore-test-20261012`，提交 `8905043ea5964475b30a54e74e8f3fe71ba1e470`。它的产品代码与 PR #1569 的 `15d1ea0` 相同（Sol 第 5 轮复审通过），只多改了一行 Mac 签名工作流的候选分支。
- Mac：`Tono-0.0.75-build75-arm64.zip`，SHA-256 `298e0f0c396d5b0b800f2cb475ee451b1c99dc39ba71de028e5b270533ff4e6b`。已用 Developer ID 签名并公证（`source=Notarized Developer ID`，stapler 校验通过）。只支持 Apple 芯片。构建记录：https://github.com/raydocs/tono/actions/runs/38192923562 。
- Windows：`Tono_0.0.75_x64-setup.exe`，SHA-256 `02f6b0e9fd1658e51aba74ab80b2bed49c407917cf07ec39b64b1448171f1719`，包含的 `tono-service.exe` SHA-256 `b6c5588cb8dad01a937e436d7ba7055627b90bc20b4b294b8e09e7f7842d2235`。没有 Authenticode 签名（现有发布流水线就没有这一步），SmartScreen 会提示，需要点“更多信息 → 仍要运行”。自动更新已关闭。构建记录：https://github.com/raydocs/tono/actions/runs/38192924877 。
- 两个包的版本号都是 0.0.75（Mac build 75），与正式候选同号。测完要手动重装正式版，不能靠自动更新替换。
- 不在本次保证范围内：Mac 旧版系统代理模式的清除（IMPLEMENTATION §4，Sol R3-M1）；手动紧急命令；降级到更早版本。

## 0b. 测试前

- 安装上面的两个测试包，先核对 SHA-256。
- 先记一次基线：
  - Mac：`scutil --dns | head -20`、`sudo pfctl -a tono.killswitch -sr`（应为空）。
  - Windows：`Get-DnsClientServerAddress`、`Get-DnsClientNrptRule`。
- 测试时手边留着第 4 节的手动恢复方法。它只是测试员的安全网，不是产品的恢复方式。

## 1. 每次点“恢复正常网络”都要记

| 记录项 | 判定 |
|---|---|
| 从点击到界面给出结果用了多少秒 | Windows 应在约 35 秒内给出结果；Mac 最多再加 10 秒（清除系统代理的等待）。超过就记下秒数。结果只会是“已恢复”“部分恢复”“状态未知”“正在恢复中”或“保护属于另一用户”之一。一直转圈不给结果算失败。 |
| 界面结果 | 记下原文或截图。截图请裁掉账号和邮箱。 |
| 实际网络 | 打开两个普通网站，并 `ping 223.5.5.5`。 |
| 显示“已恢复”时 | 网络必须真的通了，并且 2 分钟后依然通。**显示“已恢复”但网络不通，或之后又断，是最严重的失败。** |
| 显示其他结果时 | 重试入口必须还在，再点一次要有响应。 |
| 解除记录 | Mac：`sudo cat "/Library/Application Support/Tono/release-state.json"`；Windows：`type C:\ProgramData\Tono\release-state.json`（管理员）。只含代数和进程号，不含个人信息。 |
| App 日志 | Windows 日志里搜索 `恢复网络结果` 那一行；Mac 附上诊断导出。发出前去掉账号信息。 |

## 2. Mac

| # | 操作 | 期望 |
|---|---|---|
| M1 | 正常连接后点“恢复正常网络”。 | 显示“已恢复”，网络通。PF 锚点为空，DNS 与基线一致，`pgrep -fl sing-box` 为空。之后点 Connect 能正常连上。 |
| M2 | 连接过程中（在路由器上屏蔽出口 IP，让它卡在连接中）点恢复。 | 约 45 秒内给出结果，不等连接超时。2 分钟后 PF 锚点仍为空，没有自己重新连接。 |
| M3 | 先装上一个正式版并连接，再用测试包覆盖安装（App 更新或 helper 修复之后），然后点恢复。 | 同 M1。旧版本留下的任务不会在之后重新挡网。 |
| M4 | 恢复进行中执行 `sudo launchctl kickstart -k system/com.raydocs.tono.release`。 | 不能显示“已恢复”，只能是“部分恢复”或“状态未知”。约 1 分钟内 Tono 的后台组件自己恢复（App 不再提示 helper 不可用）。再点一次能完成恢复。 |
| M5 | 连续快速点两次恢复。 | 第二次显示“正在恢复中”，或者等到同一次的结果。最终网络通。 |
| M6 | 恢复后等 3 分钟，什么都不点。 | 不会自动重连，网络一直通。 |
| M7 | 恢复后重启电脑，打开 App。 | 网络通，不会自动连上。上一次恢复完整结束时，点 Connect 能连上；没有完整结束时，Connect 被拒并提示再点一次恢复，点完恢复后 Connect 能连上。重启本身不会让被拒的 Connect 直接通过。 |
| M8 | 恢复刚开始时立刻点 Connect。 | Connect 被拒绝，并说明原因（恢复进行中，或恢复未收尾），不能悄悄连上。 |
| M9 | 恢复后合上盖子等 1 分钟再打开（触发唤醒恢复），不点 Connect。 | 不会自动连上，网络一直通。 |
| M10 | 恢复后在“系统设置 → 网络 → 代理”里查看。 | 没有指向 127.0.0.1 的代理。 |

## 3. Windows

| # | 操作 | 期望 |
|---|---|---|
| W1 | 正常连接后点“恢复正常网络”。 | 显示“已恢复”，网络通。管理员执行 `netsh wfp show filters` 后，生成的 `filters.xml` 里搜不到 `Tono`；`Get-DnsClientNrptRule` 里没有 Tono 规则，DNS 与基线一致，没有 `tono-core`/`sing-box` 进程。之后 Connect 正常。 |
| W2 | 安装后执行 `sc query TonoRelease`。 | 服务存在，状态为 RUNNING。 |
| W3 | 连接过程中（屏蔽出口 IP）点恢复。 | 同 M2。 |
| W4 | 从上一个正式版覆盖安装测试包后连接，再点恢复。 | 同 M3。 |
| W5 | 恢复进行中用管理员执行 `taskkill /F /IM tono-service.exe`。 | 不能显示“已恢复”。之后 `sc qc TonoService` 的启动类型应恢复为 AUTO_START，不能停在 DISABLED。 |
| W6 | 恢复进行中执行 `sc stop TonoRelease`。 | 同 W5：主服务回到 AUTO_START。再次启动 TonoRelease 后，恢复可以用。 |
| W7 | 两个 Windows 用户：A 连接后切换到 B，B 打开 Tono 点恢复。 | B 看到“保护属于另一用户”，A 的连接不受影响。 |
| W8 | 同 M5、M6、M7、M8。 | 同上。 |
| W9 | 从“设置 → 应用”卸载。 | 卸载后 `sc query TonoRelease` 报 1060（服务不存在），网络通。 |
| W10 | 恢复完成后，在 App 里点断开或退出。 | 正常完成，不报错，网络一直通。 |
| W11 | 连接成功后点恢复，紧接着点 Connect，再等 2 分钟。 | 新连接保持正常，不会被那次恢复或旧的断开拆掉。恢复的结果可以是“已恢复”，也可以说明被新的连接取代。 |
| W12 | 如果恢复后点 Connect 被拒：提示“再点一次恢复”时，先确认网络通，点一次恢复，再点 Connect。提示“重启 Windows，然后再点恢复”时，重启电脑，点一次恢复，再点 Connect。 | 被拒期间网络一直通。只重启、不再点恢复时，Connect 仍应被拒。重启并恢复后 Connect 能连上。请记下出现提示前做了什么，并附上 `release-state.json` 和 `C:\ProgramData\Tono` 下 `dns-broker-*.json` 的文件名。 |
| W13 | 刚把测试包装到一台装过旧版本的电脑上，不重启，连接后点恢复，再点 Connect。 | 恢复后网络通，结果是“状态未知”（DNS 不能排除旧版本的迟到写入），不是“已恢复”。Connect 被拒并提示重启 Windows。重启、点恢复后，结果是“已恢复”，Connect 能连上。 |
| W14 | 恢复进行中用管理员执行 `taskkill /F /IM tono-release.exe`。 | 不能显示“已恢复”。之后 Connect 被拒并提示重启 Windows；重启、点恢复后 Connect 能连上。期间网络一直通。 |

## 4. 测试员安全网（手动恢复，不是产品功能）

只在一键恢复给不出结果、或网络一直不通时使用，并把当时的现象记下来。

- Mac：`sudo /Library/PrivilegedHelperTools/tono-core-helper --emergency-disarm`。还不行就运行 `--emergency-reset`。
- Windows：开始菜单里右键「Tono — 恢复网络 (Restore Network)」，选“以管理员身份运行”。如果被拒绝，先退出 Tono 再运行。

## 5. 不能据此声称的事

- 测试中没有复现出迟到写入（configd、WmiPrvSE），不等于这类写入不存在。
- 第 4 节的手动恢复是破窗手段，它的结果不能当作一键恢复的证据。Windows 的手动恢复不经过机器锁，见 IMPLEMENTATION.md §4。
