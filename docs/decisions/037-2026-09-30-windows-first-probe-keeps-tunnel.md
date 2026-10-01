## 2026-09-30 · Windows 网络事件的第一次数据面探测失败，要不要立刻拆隧道？

- Status: provisional
- Chosen: 不拆。核心和 WFP 保持原样，下一拍监视器再探一次；第二次仍失败才按原路径重建。核心身份变化、WFP/DNS 不健康、DIRECT 绑的网卡不再有默认路由，都不走这次等待。拒绝：一次失败就 Stop core（弱网闪断会把机器扣在 Kill Switch 里，比闪断更长）。
- Why stricter: 不放开 WFP，不增加旁路。少一次无谓的拆隧道。确认失败后的重建仍然失败关闭。
- Applied in: [#705](https://github.com/raydocs/tono/pull/705)（`plan_network_event_probe`）。
