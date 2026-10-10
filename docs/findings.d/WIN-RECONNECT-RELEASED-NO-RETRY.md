| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-RECONNECT-RELEASED-NO-RETRY | Windows 受保护重连（启动续连、Retry now、换节点重建、策略重建）失败一次后，非严格失败计划已释放原网络，退避阶梯只在保护还在时运行（`reconnect_allowed`），于是重连直接结束，也不启动无隧道探测（`unarmed_probe`）：断线、睡眠唤醒、换网后重连失败一次，这台电脑就一直断开、没人再试 | in-PR | 待开（`amp/win-reconnect-released-probe`） | 中·推导（代码阅读，非现场） | 修复后与用户手动连接的 fail-open、健康检查释放一致，改由无隧道探测接手（TCP 证明节点再连）；严格 kill switch（HoldClosed）路径不变；未加系统睡眠/唤醒事件监听（仍靠 Service 网络事件计数与探测器的上行观察） |
