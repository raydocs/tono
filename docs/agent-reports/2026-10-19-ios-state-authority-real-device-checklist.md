# iOS 状态权威：真机待验清单

来源：Devin 会话 da2f266c910f4ca9a1abdd94c8641700 的六条 needs_real_device；源码 a20b3c1074434a938d6c04da5b43b1f4c5ff3ad7，PR #1672。全部未执行；模拟器绿灯、截图、编译或 fixture 不代替这些检查。

开始前：由所有者选择 iPhone 和受控服务账号，提供合适的开发签名/App Group 条件；钥匙／账号只留在本机钥匙串等安全存储，不进聊天/仓库/日志。先做加密 Finder 或 iCloud 设备备份并确认可恢复；记录现有 VPN 配置与恢复步骤；系统级配置、签名安装与任何可能影响网络的操作必须再次得到所有者确认。

- [ ] 真实 Network Extension：签名设备启动 PacketTunnel，确认真实 sing-box graph 与当前模式/线路；不能用 NE connected 单独当确认。
- [ ] 签名 App Group：系统主屏/锁屏 widget、Control Center、SetTunnelIntent 端到端读取/操作同一状态；App 内 gallery 不算。
- [ ] 生命周期及时延：引擎崩溃、jetsam、App 被杀、重连、sleep/wake、On Demand；记录真实事件到 Home/组件/实时活动降级的时延。当前 heartbeat 五分钟、有效期十五分钟；无 stop write 的进程死亡可能保留旧确认至到期，系统 timeline 调度另测，不宣称即时检测。
- [ ] 真实服务路由：受控目录下 DNS、IPv6、UDP、直连与代理边界、失败关闭；故障注入不得记录 Reality key、UUID 或凭据。
- [ ] 真人体验/性能：VoiceOver 听读与顺序、触觉、120 Hz 帧节奏、设备内存/功耗、扩展 50 MB 预算。模拟器 CPU/RSS 不是这些指标的结论。
- [ ] 签名安装/分发：先确定批准的开发安装路径；本任务**不发 release、不上传 TestFlight**，后者若未来需要必须单独批准。unsigned Release build 只证明编译链接，不证明设备安装成功。

操作时间、安装包大小、设备当前数据和配置的备份/恢复方案待签名候选明确后再列；在所有者批准前不执行以上任一项。


## 状态修正新增核对点（未执行，纳入上面生命周期/签名组）
- 配置 save/load 的真实权限提示暂停时 Cancel：首次保存落地后不启动，On Demand最终关闭；登出等待远端logout时也不推迟本地失效与配置移除。
- App 与外部按钮的两份 NETunnelProviderManager 拷贝交错：旧保存/旧cleanup不能覆盖后来的新start；Settings删除配置后重新读取/恢复的边界。
- 隧道还在disconnecting时立即重新start，以及跨进程intent的真实顺序；单进程coordinator单测不证明iOS系统调度。
- 真实C1运行→同mode/node的C2变更Home→reload拒绝/回滚失败/重连：Home/Details/RouteCheck/系统组件不可按未运行C2解释当前流向，日志只记录非秘密状态，不输出目录或凭据。
