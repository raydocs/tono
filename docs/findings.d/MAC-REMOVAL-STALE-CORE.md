| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-REMOVAL-STALE-CORE | Since #763 a Core that survives SIGKILL no longer refuses the emergency release, so app-removal cleanup deleted the helper installation while that Core could still be running, leaving nothing to retry the stop | in-PR | [#1251](https://github.com/raydocs/tono/issues/1251) | 低·推导（P3） | Removal now keeps the installation (PF already released, DNS restored) and the idle removal check / launchd restart retries the stop. `--emergency-reset` is unchanged: the administrator asked for removal and the survivor is reported. A process stuck in uninterruptible I/O usually survives until reboot, so the helper may retry every 10 s until then. Native verification needs hardware. |

Found while rebasing #1222 (Claude Code issue-fix batch, 2026-10-01); fixed in the r2 macOS helper hunt.
