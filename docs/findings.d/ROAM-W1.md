| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ROAM-W1 | Windows 网络事件上一次数据面探测失败就拆隧道；DNS 自写窗口里的 IPv6 默认路由变化被丢掉 | in-PR | 待填 PR | 中·推导 | 判定有单元测试；真机弱网与 IPv6 未测 |

监视器在路由通知后做一次 HTTPS 证明，失败就 `handle_network_change_inner` 停核心。丢包或 DHCP 闪断因此打开一段 Kill Switch 空窗，比闪断本身更长。拓扑比较只有 IPv4，所以 DNS 自写窗口内（`external == false`）只变 IPv6 默认下一跳时，reconcile 认为没变化。

本分支第一次失败保持隧道并在下一拍复探；IPv6 `::/0` 进入拓扑，不含临时地址，不含 Tono 适配器。
