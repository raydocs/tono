| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SIGN-WIN-FLOOR-STRING | `desktop-update-sign.yml` 要求 `tono-service.exe` 里出现序列号字符串，但 rustc 把编译期 `option_env!("TONO_UPDATE_RELEASE_SEQUENCE").parse()` 折成整数，真实包里没有这个字符串，签名会拒绝每一个真实正式安装包 | in-PR | [#665](https://github.com/raydocs/tono/pull/665) | 中·已确认 | 删去该子串检查；Windows 序列号只由 guard 核对 producer 构建 job 的 env 行（每行都等于输入序列）和已签名清单绑定，包内无法离线读出下限 |

来源：核对真实 7401 安装包时发现（run 36251483271；构建 job env 29 行 `TONO_UPDATE_RELEASE_SEQUENCE: 7401`）。
解出的 `resources/tono-service.exe` 等所有二进制都不含 ASCII `7401`；`tono-service.exe` 含两处 u32 小端 7401。
同一包里 `TONO_UPDATER_PUBLIC_KEY` 字符串在 `tono-service.exe` 中存在，安装包 `.sig` 按固定公钥验证通过，安装包与 `Tono.exe.next`
的 ProductVersion 字符串为 `0.0.74`。
