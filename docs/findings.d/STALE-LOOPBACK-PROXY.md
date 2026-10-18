| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| STALE-LOOPBACK-PROXY | 系统代理指向没有监听的本机端口时，线路页只显示刷新失败，用户看不出要关掉失效代理 | in-PR | #1675 | 中·已确认 | 实机未点清理；Tono 不打开系统代理，标记恢复只在已有标记时发生 |

Windows 当前用户 `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 的 `ProxyEnable=1`、`ProxyServer=127.0.0.1:10090`，该端口没有进程。WinHTTP 是直连。关掉 `ProxyEnable` 后线路恢复。仓库里没有把 WinINet 系统代理设为开启的产品路径，混合端口是 28990 / 17970 / 旧的 7897，没有 10090。控制面 reqwest 客户端已经 `.no_proxy()`。

修复：启动和目录刷新前识别「只指向环回且端口没有监听」的代理。归属标记匹配才自动恢复；否则只在界面提示，并由「清理失效代理」在复查后关掉 `ProxyEnable`、通知 WinINet。有监听、非环回、只配置 PAC 的代理不改。
