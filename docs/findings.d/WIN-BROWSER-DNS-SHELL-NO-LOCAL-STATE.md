| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-BROWSER-DNS-SHELL-NO-LOCAL-STATE | 没装过 Chrome 的 Windows 上，国内 Chromium 套壳浏览器建了 `Google\Chrome\User Data` 却不写 `Local State`，家宽 Claude 连接的浏览器 Secure DNS 预检把它当成「扫描不完整」，每次连接都报 `TONO_BROWSER_DNS_PREFLIGHT`，重启和关浏览器都没用 | in-PR | [#1710](https://github.com/raydocs/tono/pull/1710) | 中·推导 | 客户机器上到底是缺 `Local State` 还是注册表策略读不到，还没有客户的只读诊断输出；本修复把前者改成按默认值加托管策略判断，后者仍拒绝但在报错里写出 HKLM/HKCU 和具体键值；套壳浏览器自己的 DoH 设置本来就不在覆盖范围内 |

2026-10-21 客户实测（Windows 11 家庭中文版，0.0.80，目录 95）：报 `Chrome: the bounded Secure DNS configuration scan is incomplete`。客户说没开任何浏览器、也从没下载过 Chrome。报错前缀是 `Chrome:` 而不是超时路径的 `Chrome/Edge:`，说明失败出在 Chrome 那一轮的目录或策略读取，不是 5 秒超时。
