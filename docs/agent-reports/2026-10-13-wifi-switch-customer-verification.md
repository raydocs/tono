# Wi-Fi 切换问题：客户验证指南 / Wi-Fi switch customer verification

## 中文

这次请验证：从手机热点切换到酒店或办公室 Wi-Fi 后，电脑是否仍会断网，必须卸载 Tono 才能恢复。相关修复 [#1569](https://github.com/raydocs/tono/pull/1569)、[#1591](https://github.com/raydocs/tono/pull/1591)、[#1599](https://github.com/raydocs/tono/pull/1599) 已合入 main；本次使用**内部候选 A**，实际效果需要在你的电脑上确认。

### 1. 请先告诉我们

- 电脑平台：Mac 或 Windows。
- 系统版本：macOS / Windows 的完整版本号。
- 目前安装的 Tono 版本（Mac 请同时提供构建号）。
- 网络切换：哪个手机热点 → 哪个酒店 / 办公室 Wi-Fi？目标 Wi-Fi 是否需要打开网页登录或接受条款（captive portal）？

### 2. 完整卸载旧版，再安装候选 A

先下载候选 A，避免卸载时断网无法下载。支持人员会填写下面的链接、版本和哈希；占位符未填写前，请先等安装包信息。

候选 A 源码提交：`<CANDIDATE_A_SOURCE_SHA>`。

| 平台 | 下载链接 | SHA-256 | 版本 / 构建号 |
| --- | --- | --- | --- |
| macOS | `<MAC_DOWNLOAD_URL>` | `<MAC_SHA256>` | `<MAC_VERSION_BUILD>` |
| Windows | `<WINDOWS_DOWNLOAD_URL>` | `<WINDOWS_SHA256>` | `<WINDOWS_VERSION_BUILD>` |

核对**下载的原始安装包**，再打开它：

- **Mac：**打开「终端」，输入下面的命令，把路径换成下载文件的真实路径。输出前面的 64 位哈希应与表格完全一致。

  ```sh
  shasum -a 256 "/path/to/candidate-A-package"
  ```

- **Windows：**打开 PowerShell，运行下面的命令，把路径换成真实路径。`Hash` 应与表格一致，大小写不影响比较。

  ```powershell
  Get-FileHash -Algorithm SHA256 -LiteralPath "C:\path\to\candidate-A-installer.exe"
  ```

哈希不一致时不要安装，把实际哈希和下载文件名发给支持人员。

1. 在旧版 Tono 中先恢复正常网络，然后退出 Tono（包括菜单栏 / 托盘）。下节列出了恢复按钮的实际名称。
2. **Mac：**在「应用程序」中把旧 `Tono.app` 移到废纸篓；如果用户自己的「应用程序」目录也有旧副本，一并移除。弹出安装镜像，等待约 30 秒，让旧版网络助手完成清理。**Windows：**从系统「设置 → 应用」卸载 Tono，允许管理员提示，等待卸载完成；仅删除快捷方式或程序文件不算卸载。
3. 重启电脑。先确认不安装 Tono 时，两张网络都能正常上网；如有网页登录，先完成登录。记录两张网络原来的 DNS 是自动获取还是手动配置，以及手动 DNS 地址，供恢复后对照。若卸载报错或网络仍未恢复，先把错误和本指南的系统命令输出发给支持人员。
4. 安装已核对哈希的候选 A，允许正常的安装 / 网络助手授权。打开 Tono，记录候选 A 的实际版本 / 构建号。此次使用上面的内部安装包。

### 3. 按顺序复现，并记下时间

本指南所说的 **“Restore normal network / 恢复正常网络”**，请按实际界面找以下按钮：Mac 为 **“Restore internet / 恢复正常网络”**（菜单栏可能显示 **“Restore internet (turn off protection) / 恢复正常网络（关闭保护）”**）；Windows 连接页面为 **“Restore Normal Internet / 恢复正常网络”**，确认框标题为 **“Restore normal internet / 恢复正常网络”**，登录页可能显示 **“Restore internet / 恢复正常网络”**。恢复会关闭 Tono 保护；重新连接前，流量通过普通网络上网。

1. 连上手机热点，确认网页能打开。
2. 连接 Tono，确认能上网。收集一份 **`before-switch`（切换前）**证据，方法见下一节。
3. 保持 Tono 开着，将电脑 Wi-Fi 从热点切到目标酒店 / 办公室 Wi-Fi。记录切换时间，等待约 **60 秒**，记录 Tono 状态、网页是否能打开，以及恢复上网时间。
4. 预期：Tono 自动重连并恢复上网；或者至少电脑取得目标网络的有效新租约 / IP 地址，普通互联网恢复。若目标 Wi-Fi 要网页登录，记录门户出现和登录完成的时间；登录完成后再判断是否能上网。保存 **`after-switch`（切换后）**证据和状态截图。
5. 若仍显示 **“Protected offline / 保护中，未连上”**，或仍无法上网，先保存切换后证据，再点一次上面对应的**恢复正常网络**按钮，并完成确认 / 管理员授权。记录点击、授权结束、收到结果和网页恢复的时间。**从点击开始，最多 35 秒内必须有明确响应，互联网也必须恢复**；若授权花了时间，单独注明。一直转圈、没有结果、报错或仍断网，都记为失败并保留原文。
6. 保存 **`after-restore`（恢复后）**证据，完成下一节的红线检查后再重连、重启或卸载。如果自动恢复成功，就注明「自动恢复成功，无需应急恢复」，无需为复现制造断网；仍请手动恢复一次并收集恢复后证据，以检查 DNS 清理。

可直接填写下面的记录，时间带上时区：

```text
平台 / 系统版本：
旧 Tono 版本；候选 A 实际版本 / 构建号：
候选 A 文件名 / SHA-256：
热点 → 目标 Wi-Fi；是否有网页登录：
时区：
连接 Tono 时间：
切换 Wi-Fi 时间：
门户出现 / 登录完成时间（没有则写无）：
切换后约 60 秒：Tono 状态 / 是否能上网 / 新 IP 地址：
点击恢复时间；确认 / 授权结束时间：
收到响应时间 / 响应原文；距离点击多少秒：
恢复上网时间；距离点击多少秒：
恢复后 DNS / NRPT 红线结果：
```

### 4. 三个时间点都收集同一组证据

分别建 `before-switch`、`after-switch`、`after-restore` 文件夹，把该阶段的导出文件、命令输出和截图放进去，避免覆盖。**恢复前先保存切换后证据。**复制到剪贴板的内容要立即粘贴到文本文件并保存。

**Mac**

- 打开 **“Logs / 日志”**页面，执行 **Export logs（导出日志）**：当前按钮实际显示 **“Export / 导出”**，默认保存名为 **`clash-logs.txt`**。
- 保存 **“Show diagnostic log in Finder”** 打开的那份诊断日志文件。源码中的完整按钮名为 **“Show Diagnostics Log in Finder / 在访达中显示诊断日志”**（登录错误详情中）；已登录时，可到 **“Support & Diagnostics / 支持与诊断”** 的本地日志区域点 **“Show in Finder / 在访达中显示”**，复制它选中的文件。需要的是文件内容，不只是路径或截图。
- 在 **“Support & Diagnostics / 支持与诊断”** 复制诊断文本（**“Copy diagnostics / 复制诊断”**）。当前页面的诊断报告按钮实际为 **“Copy report / 复制报告”**；点它并粘贴到 `diagnostics.txt`。
- 打开「终端」，逐条运行以下命令，把命令、输出和采集时间保存到 `network.txt`。`sudo` 可能要求电脑管理员密码，输入时不显示字符。

  ```sh
  date
  scutil --dns | head -40
  sudo pfctl -sr
  ifconfig en0
  ```

  如果 Wi-Fi 不在 `en0`，仍保存这条输出，并补上实际 Wi-Fi 接口的 `ifconfig` 输出（把 `en0` 换成对应名称）。

**Windows**

- 打开 **“Settings > Advanced > Export Diagnostic Info / 设置 > 高级 > 导出诊断信息”**。它把诊断信息复制到剪贴板：立即粘贴到记事本，保存为 `diagnostics.txt`。若候选 A 没有「高级」这一项，当前界面的替代入口是 **“Support / 支持”** 页面 → **“Diagnostics report / 诊断报告”** → **“Copy details / 复制详情”**；同样粘贴保存，并注明使用了替代入口。
- 以管理员身份打开 PowerShell，逐条运行以下命令，把命令、完整输出和采集时间保存到 `network.txt`。命令没有输出时也记录「无输出」；报错时保留错误，不能当作通过。

  ```powershell
  Get-Date -Format o
  ipconfig /all
  Get-DnsClientNrptRule
  Get-DnsClientServerAddress
  ```

### 5. 恢复后的红线检查

这些检查在**恢复正常网络完成后、重新连接 Tono 之前**做；Tono 保护期间出现其 DNS 地址不用于判断本项失败。

- **所有网络适配器 / 网络服务**（包括未连接的）都不能还把 DNS 指向 **`198.18.0.2`** 或 **Tono 留下的回环解析器**，例如 Tono 设置的 `127.0.0.1` / `::1`。Windows 查看 `ipconfig /all` 和 `Get-DnsClientServerAddress`。Mac 的 `scutil` 前 40 行可能不覆盖全部服务，请再逐一查看系统网络设置的 DNS；也可运行 `networksetup -listallnetworkservices`，然后对每个列出的服务运行 `networksetup -getdnsservers "服务名称"`，保存输出。原本由其他软件配置的回环 DNS，要注明原有软件和配置，交给支持人员区分。
- **Windows：`Get-DnsClientNrptRule` 必须无规则（无输出）。**如公司原来就有 NRPT 规则，也请原样回传并注明背景，由工程师核对，不要自行删除。Mac 不适用 NRPT。
- DNS 应恢复为你原来的手动解析器，或 **DHCP 自动获取**。自动获取时，酒店 / 办公室 Wi-Fi 的 DNS 地址可以与热点不同；不要为了让地址相同而改成手动 DNS。

任一红线不满足：注明「红线失败」，发回**平台 / 系统 / 旧版与候选版本、安装包哈希、网络类型与门户情况、时间记录、三个阶段的全部证据、残留 DNS 的适配器名称 / 地址、NRPT 完整输出和恢复结果截图 / 错误原文**。先保存证据，再由支持人员协助恢复，避免先改 DNS、删规则或卸载而丢掉现场。即使网页能打开，红线失败也不能算通过。

### 6. 给工程师

将客户时间线、三阶段日志和红线结果附到 [#1591](https://github.com/raydocs/tono/pull/1591)、[#1599](https://github.com/raydocs/tono/pull/1599)、[#1605](https://github.com/raydocs/tono/pull/1605) 或对应问题 issue；注明候选 A 的源码 SHA、版本、安装包 SHA-256。客户把材料发给支持人员即可，无需操作 GitHub。#1605 是相关排查记录，不列为本候选已包含的修复。日志与系统输出可能包含网络名称、地址或访问记录，请通过支持人员提供的私密渠道回传，公开 PR / issue 只贴脱敏材料。

## English

Please check whether switching from a phone hotspot to hotel or office Wi-Fi still leaves your computer without internet until Tono is uninstalled. Fixes [#1569](https://github.com/raydocs/tono/pull/1569), [#1591](https://github.com/raydocs/tono/pull/1591), and [#1599](https://github.com/raydocs/tono/pull/1599) have merged into main. This test uses **internal candidate A**; its behavior needs confirmation on your computer.

### 1. Tell us about your setup

- Platform: Mac or Windows.
- Full macOS / Windows version.
- Currently installed Tono version (include the build number on Mac).
- Network switch: which phone hotspot → which hotel / office Wi-Fi? Does the destination require a web login or acceptance of terms (a captive portal)?

### 2. Fully uninstall the old version, then install candidate A

Download candidate A first so you have it if uninstalling interrupts the connection. Support will fill in the links, versions, and hashes below; wait for those details if placeholders remain.

Candidate A source commit: `<CANDIDATE_A_SOURCE_SHA>`.

| Platform | Download link | SHA-256 | Version / build |
| --- | --- | --- | --- |
| macOS | `<MAC_DOWNLOAD_URL>` | `<MAC_SHA256>` | `<MAC_VERSION_BUILD>` |
| Windows | `<WINDOWS_DOWNLOAD_URL>` | `<WINDOWS_SHA256>` | `<WINDOWS_VERSION_BUILD>` |

Verify the **original downloaded package** before opening it:

- **Mac:** Open Terminal and run this command, replacing the path with the downloaded file's actual path. The leading 64-character hash must match the table exactly.

  ```sh
  shasum -a 256 "/path/to/candidate-A-package"
  ```

- **Windows:** Open PowerShell and run this command with the actual file path. `Hash` must match the table; letter case does not matter.

  ```powershell
  Get-FileHash -Algorithm SHA256 -LiteralPath "C:\path\to\candidate-A-installer.exe"
  ```

If the hash differs, do not install. Send support the actual hash and downloaded filename.

1. Restore normal internet in the old Tono, then quit Tono, including its menu-bar / tray app. The next section lists the actual restore button labels.
2. **Mac:** Move the old `Tono.app` from Applications to Trash; remove any old copy in your own Applications folder too. Eject the installer disk image and wait about 30 seconds for the old network helper to clean up. **Windows:** Uninstall Tono through the system's Settings → Apps, approve the administrator prompt, and let uninstall finish. Deleting a shortcut or program files alone is not an uninstall.
3. Restart the computer. Before installing Tono, confirm both networks provide internet; complete any captive-portal login. Record whether each network originally used automatic or manual DNS, including any manual DNS addresses, for comparison after restore. If uninstall reports an error or internet is still unavailable, send support the error and the system-command output listed below first.
4. Install the hash-verified candidate A and approve the normal installation / network-helper prompts. Open Tono and record its actual version / build. Use the internal package linked above for this test.

### 3. Reproduce in order and record the times

The action called **“Restore normal network / 恢复正常网络”** in this guide appears as **“Restore internet / 恢复正常网络”** on Mac (the menu-bar item may say **“Restore internet (turn off protection) / 恢复正常网络（关闭保护）”**). On the Windows connection page it is **“Restore Normal Internet / 恢复正常网络”**, with confirmation title **“Restore normal internet / 恢复正常网络”**; the sign-in page may say **“Restore internet / 恢复正常网络”**. Restore turns Tono protection off; traffic uses the ordinary network until you reconnect.

1. Connect to the phone hotspot and confirm a webpage opens.
2. Connect Tono and confirm internet works. Collect **`before-switch`** evidence using the next section.
3. Leave Tono running and switch the computer's Wi-Fi from the hotspot to the destination hotel / office network. Record the switch time, wait about **60 seconds**, and note Tono's status, whether a webpage opens, and when internet returns.
4. Expected: Tono reconnects automatically and internet works; or at least the computer obtains a valid new lease / IP address on the destination network and ordinary internet works. If the Wi-Fi requires a captive portal, record when it appears and when login finishes; assess internet access after login. Save **`after-switch`** evidence and a status screenshot.
5. If it remains **“Protected offline / 保护中，未连上”**, or internet still does not work, save the after-switch evidence first, then click the matching **restore normal network** button once and complete any confirmation / administrator prompt. Record the click, authorization completion, result, and when a webpage works again. **Within 35 seconds of the click, there must be a clear response and internet must return.** Note separately any time spent authorizing. An endless spinner, no result, an error, or continued loss of internet is a failure; preserve the exact message.
6. Collect **`after-restore`** evidence and complete the red-line checks below before reconnecting, restarting, or uninstalling. If recovery was automatic, record “automatic recovery succeeded; emergency restore not needed”; there is no need to manufacture a failure. Still perform one manual restore and collect after-restore evidence to check DNS cleanup.

You can fill in this record; include the time zone:

```text
Platform / OS version:
Old Tono version; actual candidate A version / build:
Candidate A filename / SHA-256:
Hotspot → destination Wi-Fi; captive portal required:
Time zone:
Tono connected at:
Wi-Fi switched at:
Portal appeared / login completed at (or none):
About 60 seconds after switch: Tono status / internet working / new IP address:
Restore clicked at; confirmation / authorization completed at:
Response time / exact response; seconds since click:
Internet returned at; seconds since click:
After-restore DNS / NRPT red-line results:
```

### 4. Collect the same evidence at all three stages

Create separate `before-switch`, `after-switch`, and `after-restore` folders for each stage's exports, command output, and screenshots so nothing is overwritten. **Save after-switch evidence before restoring.** Paste anything copied to the clipboard into a text file immediately and save it.

**Mac**

- Open **“Logs / 日志”** and perform **Export logs（导出日志）**. The current button actually says **“Export / 导出”**; the default filename is **`clash-logs.txt`**.
- Save the diagnostic log file revealed by **“Show diagnostic log in Finder”**. The full source label is **“Show Diagnostics Log in Finder / 在访达中显示诊断日志”** (in sign-in error details). When signed in, use **“Support & Diagnostics / 支持与诊断”** → its local logs area → **“Show in Finder / 在访达中显示”**, and copy the selected file. Send the file contents, not just its path or a screenshot.
- Copy diagnostic text in **“Support & Diagnostics / 支持与诊断”** (**“Copy diagnostics / 复制诊断”**). The current page's diagnostic report button actually says **“Copy report / 复制报告”**; click it and paste into `diagnostics.txt`.
- Open Terminal, run these commands one at a time, and save each command, its output, and the capture time in `network.txt`. `sudo` may ask for your computer's administrator password; typed characters are hidden.

  ```sh
  date
  scutil --dns | head -40
  sudo pfctl -sr
  ifconfig en0
  ```

  If Wi-Fi uses an interface other than `en0`, keep this output and add `ifconfig` output for the actual Wi-Fi interface, substituting its name for `en0`.

**Windows**

- Open **“Settings > Advanced > Export Diagnostic Info / 设置 > 高级 > 导出诊断信息”**. It copies diagnostics to the clipboard: immediately paste into Notepad and save as `diagnostics.txt`. If candidate A has no Advanced item, the current interface's alternative is **“Support / 支持”** → **“Diagnostics report / 诊断报告”** → **“Copy details / 复制详情”**. Paste and save the same way, and note that you used the alternative.
- Open PowerShell as administrator and run these commands one at a time. Save the commands, full output, and capture time in `network.txt`. Record “no output” when a command prints nothing; preserve errors, which do not count as a pass.

  ```powershell
  Get-Date -Format o
  ipconfig /all
  Get-DnsClientNrptRule
  Get-DnsClientServerAddress
  ```

### 5. Red-line checks after restore

Check **after restore normal network completes, before reconnecting Tono**. Tono DNS addresses while protection is active do not fail this check.

- **No network adapter / network service**, including disconnected ones, may still use **`198.18.0.2`** or a **loopback resolver left by Tono**, such as Tono-configured `127.0.0.1` / `::1`, for DNS. On Windows inspect `ipconfig /all` and `Get-DnsClientServerAddress`. On Mac, the first 40 lines of `scutil` may omit services; also inspect DNS for each service in system network settings. Alternatively, run `networksetup -listallnetworkservices`, then `networksetup -getdnsservers "service name"` for each listed service, and save the output. If another application originally configured loopback DNS, identify that application and original setting so support can distinguish it.
- **Windows: `Get-DnsClientNrptRule` must show no rules (no output).** If your company already had NRPT rules, send them unchanged and explain that background for engineering to check; do not delete them yourself. NRPT does not apply to Mac.
- DNS must return to your original manual resolver or **automatic DHCP**. With automatic DNS, hotel / office Wi-Fi can provide different addresses from the hotspot; do not switch to manual DNS just to make the addresses match.

If any red line fails, report **“red-line failure”** and send **platform / OS / old and candidate versions, package hash, network types and portal details, the time record, all three stages of evidence, affected adapter names / remaining DNS addresses, full NRPT output, and the restore-result screenshot / exact error**. Save evidence first, then get support's help restoring access; changing DNS, deleting rules, or uninstalling first can erase the evidence. A working webpage does not turn a red-line failure into a pass.

### 6. For the engineer

Attach the customer's timeline, three-stage logs, and red-line results to [#1591](https://github.com/raydocs/tono/pull/1591), [#1599](https://github.com/raydocs/tono/pull/1599), [#1605](https://github.com/raydocs/tono/pull/1605), or the corresponding issue. Include candidate A's source SHA, version, and package SHA-256. Customers only need to send materials to support; they need not use GitHub. #1605 is related investigation history, not listed as an included candidate fix. Logs and system output can contain network names, addresses, or browsing records; use support's private channel for originals and post only redacted material on public PRs / issues.

---
_Generated by Codex (gpt-6.1-sol) via Grok Bot._
