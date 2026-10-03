| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R6-WIN-UNINSTALL-SING-BOX-PIN | Windows 卸载不删 `$INSTDIR\sing-box-sha256.txt` 及其事务暂存名，`C:\Program Files\Tono` 卸载后仍在 | fixed(1f44284f) | [#1317](https://github.com/raydocs/tono/issues/1317) | 低·实证 | 实机卸载未跑；`%ProgramData%\Tono\bin\sing-box-sha256.txt` 仍由 Service 卸载器留下（外观问题，未修） |

来源：R6 打包扫描（0.0.74 候选 36e3194d）。安装把 pin 复制到 sing-box.exe 旁边，生成的卸载列表和 `RemoveKnownLegacyPayload` 都不含它，最后的 `RMDir` 删不掉非空目录。
