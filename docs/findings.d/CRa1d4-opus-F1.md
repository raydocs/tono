| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CRa1d4-opus-F1 | Windows 提升的安装门禁在 `%ProgramData%\Tono` 不可用或主日志写失败时，改在 `std::env::temp_dir()` 下创建、追加并轮换 `install-gate.log`；该目录（TEMP 变量、内容、上级连接点）由同一用户的中完整性进程控制，`append_entry` 只检查最后一级，违背「特权写入方不跟随链接」 | in-PR | [#677](https://github.com/raydocs/tono/pull/677) | 低·推导（审查定为 minor：同一用户、UAC 提升边界） | 去掉 TEMP 兜底：受保护日志写不了就不写文件日志，reason 文件第二行照旧是「(the install-gate log could not be written)」，NSIS 对话框的「日志」行显示这句（它只在 reason 文件缺失时才回退到 ProgramData 路径）。reason 文件本身在 NSIS 的 `$PLUGINSDIR`（同样在用户 TEMP 下），仍是 `create_new` + 不跟随最后一级重解析点，本条未改。未在 Windows 实机点过对话框 |

来源：合并回归审查 run `a1d498c8`（区间 `e2aff1a3...ccbc50a8`）opus:F1。TEMP 兜底由 WIN-GATE-OPAQUE（#669）引入。
