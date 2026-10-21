## 2026-10-18 · 失效的本机系统代理不再挡住线路

- 归属：SHIP_PLAN G2（连不上要有下一手）；Windows 桌面。不进客户发布。
- 来源：`origin/main` `c39a9c17d`（#1674 合入之后）；分支 `cursor/stale-loopback-proxy-f082`；[#1675](https://github.com/raydocs/tono/pull/1675)；未合 main。
- 缺陷修复：线路页在系统代理指向没有监听的 `127.0.0.1:10090` 时显示「无法读取线路偏好 / 最近一次刷新失败 / 暂无可用线路」。Tono 自己并不打开 WinINet 系统代理，端口 10090 也不是 Tono 的端口。启动、状态恢复，以及每次目录刷新之前，若 `ProxyEnable` 指向仅含环回地址且端口没有监听的代理：有归属标记则恢复标记里的原设置；否则不改注册表，控制面客户端本来就 `no_proxy`，界面给出中文说明和「清理失效代理」。按钮再查一次，仍然是失效环回才把 `ProxyEnable` 置 0 并 `InternetSetOption` `SETTINGS_CHANGED` / `REFRESH`。活着的端口、非环回、只开 PAC 都不动。见 `docs/findings.d/STALE-LOOPBACK-PROXY.md` 与 `docs/agent-reports/2026-10-18-stale-system-proxy.md`。
- 新增/优化：无。产品路径仍然不把系统代理设为开启，因此也不会写入归属标记。
- 工程与测试：`stale_proxy.rs` 五个检测用例（失效环回、有监听、非环回、仅 PAC、标记恢复）；`tono.test.ts` 把 `TONO_STALE_SYSTEM_PROXY` 和代理连接失败映射到 `tono.nodes.staleSystemProxyNotice`。
- 验证：本机未跑 Windows `cargo test` 与前端 vitest（Linux 云代理不编 Windows 目标）。托管 CI 跑 `windows / app-rust` 与 `windows / app`。
- 候选/发布：仅源码，无新候选。
- 剩余限制：实机未点「清理失效代理」。不部署生产。

## 2026-10-18 · 续记
- #1674 合入 main（`c39a9c17d`）后变基。线路页同时留下「重新准备出口身份」和「清理失效代理」。
- 独立审查指出：归属标记里若 `proxyEnable` 为真，恢复会把系统代理再次打开。分类改为这种标记不自动恢复，按钮只关 `ProxyEnable`；`restore_internet_proxy_settings` 在 `enable` 为真时不写注册表。
