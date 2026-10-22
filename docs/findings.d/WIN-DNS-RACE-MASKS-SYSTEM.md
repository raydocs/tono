| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DNS-RACE-MASKS-SYSTEM | TUN-only 准入后，Service 系统 DNS 查询持续 Err/超时可无 advisory，首页缺少系统 DNS 未验证告警 | open | [draft #1720](https://github.com/raydocs/tono/pull/1720) | 中·推导 | 原生 RED/GREEN 与生命周期独立审查见 delivering PR；Win10/11 系统解析及 UI 待实机；仅修 DNS 可见性，不涉及缺上行、自动修复/释放/重连 |

原核验记录于 #1386 / #1395：系统 DNS 并非「连接后从不测」，X2-2（fixed d98b217d）已约每 30 秒测有效 NRPT 和系统查询；缺的是 Err/超时的独立可见状态。Support 诊断已读取现有 advisory，旧文「App 健康也不读 advisory」过宽；本轮补首页展示。

2026-10-05 的「等待所有者决定」「warning 不够，持续失败必须走 030/031」已由 [decision 060](../decisions/060-2026-10-05-keep-connected-warn-on-dns-and-uplink.md)（已合 #1397）取代：保持 Connected/Core/WFP，显示 Service 系统查询告警。不能把旧核验建议继续当作阻塞产品决策，亦不能因此撤掉 SHIP_PLAN 的 Win10 TUN-only 快修。

2026-10-22 续修：健康 Tono NRPT + 连续 query Err/超时报告 `TONO_DNS_SYSTEM_UNVERIFIED`，不是证明其他策略冲突，不写硬 `last_error`。首页现有告警卡提供中英提示和检查/诊断入口；fresh success 清除未验证态，缓存/configuration 读不算成功。Service 现有 Core 实例及 lifecycle 代次阻止旧 observer 跨会话发布，App connect_generation 退休即清除展示投影；disconnect / 新 Core generation 清除旧证据。无需新增 Service IPC 字段，不改企业 NRPT 或任何自动处置策略。源码仍为 draft，未合 main 前保持 open。
