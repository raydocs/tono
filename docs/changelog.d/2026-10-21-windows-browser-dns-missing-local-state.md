## 2026-10-21 · Windows 家宽连接不再被没有 Local State 的 Chrome 目录挡住

- 归属：客户 Windows 11 家庭中文版 / 0.0.80 实测（[WIN-BROWSER-DNS-SHELL-NO-LOCAL-STATE](../findings.d/WIN-BROWSER-DNS-SHELL-NO-LOCAL-STATE.md)）。没装过 Chrome，连接一直报 `TONO_BROWSER_DNS_PREFLIGHT`「Chrome: the bounded Secure DNS configuration scan is incomplete」。
- 来源：分支 `fix/windows-browser-dns-missing-local-state`，基于 main `1258c87`；[#1710](https://github.com/raydocs/tono/pull/1710)，未合 main。
- 缺陷修复：
  - `Google\Chrome\User Data` 这类目录存在、但里面既没有 `Local State` 也没有 Chromium 运行时持有的 `lockfile` 时（没有浏览器在用；国内套壳浏览器常只建目录），按「没有这个目录」同样处理：浏览器默认值加托管策略，Chrome 下次启动读到的也正是默认值。有 `lockfile` 说明浏览器正在用这个目录、Secure DNS 可能只在内存里，仍按扫描不完整拒绝（托管策略强制 Off 除外），每次复查都一样。托管策略设成 Secure 或带自定义 DoH 模板时照样拦截，比原来只放行 managed-off 更准确。
  - 托管策略注册表键或值读不到（权限被锁、类型不是字符串）仍然拒绝连接，但报错改为写明哪一项，例如「the managed Secure DNS policy (HKLM DnsOverHttpsMode) could not be read」，并提示可能是别的程序写坏或锁住了这条策略，不再笼统说扫描不完整。
- 工程与测试：`existing_root_without_local_state_uses_browser_defaults_and_policy`（替换原先「缺 Local State 即不完整」的用例）、`running_browser_without_local_state_stays_incomplete_unless_managed_off` 和 `unreadable_policy_names_the_registry_value_without_prescribing_dns_changes`。`Local State` 存在但损坏、超限、读不了，以及 5 秒超时，仍按原样 fail-closed。README 同步。
- 验证：托管 CI 跑，结果见 PR 验证评论。本机不跑 cargo。
- 候选/发布：仅源码，无新候选。
- 剩余限制：判断「有没有浏览器在用」只看 `lockfile`；Chrome 不在运行时 `Local State` 被移走又在下次启动前放回，这期间按默认值判断，放回后的下一次复查才拦。套壳浏览器自己的 DoH 设置不在扫描范围内（README 原本就写明不覆盖其他浏览器）。
