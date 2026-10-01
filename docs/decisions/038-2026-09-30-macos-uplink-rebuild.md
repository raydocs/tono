## 2026-09-30 · macOS 已连接时，哪些网络变化可以拆掉隧道？

- Status: provisional
- Chosen: 只在默认上行的服务、接口、可用 IPv4 地址或 IPv4 网关变成另一个具体值时重建；IPv6-only 才把 IPv6 默认下一跳算进身份。次要网卡出现、DHCP 空窗、APIPA、动态库读失败、双栈上的 IPv6 路由器抖动都保持隧道。拒绝：继续用「所有 up 的 IPv4 地址」指纹（插扩展坞就拆隧道），以及为了门户登录临时放开 PF。
- Why stricter: PF 保持失败关闭，不新增旁路。少拆一次隧道就是少一次 Kill Switch 把机器扣在无网络上的窗口。双栈不因 IPv6 RA 抖动拆掉仍可用的 IPv4 上行。
- Applied in: [#702](https://github.com/raydocs/tono/pull/702)（`NetworkUplinkSnapshot`）。
