# 2026-10-18 · 失效本机代理

Tono 不是 `127.0.0.1:10090` 的来源。Windows 产品路径不把 WinINet `ProxyEnable` 设为 1（`CoreManager::apply_proxy_after_start` 是空操作，偏好里的系统代理被强制关掉）。仓库里的混合端口是 28990、17970 和旧的 7897，没有 10090。那条代理是别的程序留下的。

控制面 HTTP 客户端本来就 `no_proxy`，不走这条失效代理。检测放在启动、状态恢复失败后的重试，以及每次目录同步之前。只有「代理已启用，且每一段都是 127.0.0.1 / localhost / ::1，且这些端口都没有 TCP 监听」才算失效。有监听、夹了非环回地址、或者只配了 PAC 而 `ProxyEnable` 为 0，都不改注册表。

归属标记 `system-proxy-owner.json` 能在标记与当前 `ProxyServer` 一致时把先前的设置写回去。产品路径不写入这个标记，因为写入意味着 Tono 自己打开过系统代理，而那条路径保持关闭。

不是 Tono 留下的失效环回代理，界面用中文说明，并提供「清理失效代理」。按钮会再查一次：端口已经有程序在听就不动；仍然失效才把 `ProxyEnable` 写成 0，并调用 `InternetSetOption` 的 `INTERNET_OPTION_PROXY_SETTINGS_CHANGED` 和 `INTERNET_OPTION_REFRESH`。不改 `ProxyServer`，也不改 RAS 拨号项。

本代理没有对生产执行任何命令。
