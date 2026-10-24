| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ANDROID-CORE-STOP-CALLBACK-NO-ORIGIN | 旧 core 退出后迟生成的 serviceStop 回调可能停止后继连接 | refuted | [#1742](https://github.com/raydocs/tono/pull/1742) | 中·推导 | 当前 pin 的 serviceStop 仅由 ManagedService.StopService RPC 调用，不是 core 实例退出回调；pin 升级需重新复核，不能推广为所有未来 core 事件均已隔离 |

Claude 对 head `378c0c376` 的非阻塞意见 1。当前代码确实在回调到达时读取 generation，但“来自旧 core 生命周期”的前提不成立。
核查的是仓库 `apps/android/supply-chain/sing-box/sing-box.pin` 指定的 upstream commit `25b0d5ea3e466d246c708ac0f20d0448110e566c`，不是浮动 main；build-libbox.sh 没有补丁步骤。
- [daemon/managed_service.go:37-43](https://github.com/SagerNet/sing-box/blob/25b0d5ea3e466d246c708ac0f20d0448110e566c/daemon/managed_service.go#L37-L43)：StopService RPC 同步调用 handler.ServiceStop。
- [experimental/libbox/command_server.go:320-322](https://github.com/SagerNet/sing-box/blob/25b0d5ea3e466d246c708ac0f20d0448110e566c/experimental/libbox/command_server.go#L320-L322)：仅转发上述命令。
- [daemon/started_service.go:329-353](https://github.com/SagerNet/sing-box/blob/25b0d5ea3e466d246c708ac0f20d0448110e566c/daemon/started_service.go#L329-L353)：CloseService 关闭 instance、更新状态，不调用 ServiceStop。
完整 pinned 源码执行 `rg -n '\.ServiceStop\('` 只有前两个调用点。晚到的 StopService RPC 是到达时的新管理命令，不带某个旧 core 的退出来源；把 generation 固定到首次 server 创建也会误丢后续合法停止命令。本轮保持接收命令时 stamp，继续隔离已经入队后过期的命令，不凭假设引入 server 每次重建。
