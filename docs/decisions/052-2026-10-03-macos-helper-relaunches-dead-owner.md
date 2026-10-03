## 2026-10-03 · macOS：App 在保护未解除时死掉，helper 要不要把它拉起来

- Status: provisional
- Chosen: 拉起来。helper 的 10 秒空闲检查发现记录的属主已退出、PF 状态文件还在、机器醒着、没有待执行的原生升级，就以该用户身份让 Launch Services 打开 `/Applications/Tono.app`（和原生升级后拉起新 App 用同一条 `launchctl asuser … sudo -u … open` 路径），只打开通过 Developer ID 校验的已安装包。同一个属主最多拉两次，间隔约 30 秒。拉起来的 App 自己走现有的崩溃后恢复路径（PF 已武装则自动重连）。决策 049 的「出口不可达约 70 秒后放开」保留为最后一道保险。被拒的选项：只放开不拉起（用户看不到状态、要手动重开）；helper 自己换节点重连（把目录、策略和凭据搬进特权路径，违背「特权路径只做最少的事」）；改成 Network Extension（可行但要重写 PF kill switch 和升级门控，放到 0.0.75 之后再评估）。
- 所有者 2026-10-03 会话内批准方案 A、B（「按你说的做」）；文件状态仍是 provisional，只有所有者改成 owner。B（App 启动时接管活会话）经核对已基本存在于 main：崩溃后 App 启动见 PF 已武装即自动重连（`acceptCloudOnlyTransport(resumeProtection:)` → `attemptAutomaticConnect`），只是先停旧 Core 再起新 Core，不是原地接管；这次不改。
- Why stricter: 不新增任何网络放行；拉起 App 不改 PF、不碰 Core。root 不运行 App，只向用户会话发打开请求；App 像任何对端一样重新鉴权。拉起有上限，不会无限重启一个反复崩溃的 App。代价：用户强退 Tono 而保护仍在时，它会回来（正常退出会先解除保护、清掉属主，不触发）。
- Applied in: `fix/mac-orphan-relaunch-20261003`。
