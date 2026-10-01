| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SOL-C4-QUOTA-RETENTION-REWIND | 节点流量缺项时两级留存丢弃最近完整计数，配额回读伪造重置并多算恢复流量 | in-PR | hunt/sol-r3ingest-quota-rollup-counters | 低·已确认（P2，D1 回归） | 只影响运维节点用量/预测，不改客户计费或网络；缺项持续至留存边界才触发；未证明生产节点出现过该过渡，未部署 |

The supported snapshot parser admits missing traffic fields. Raw reads select the most recent complete network-counter pair, but both retention layers previously retained only the closing observation. A later incomplete observation erased a complete pair when the source tier expired. The reader then selected an older pair; `rollNodeCycle` treated the rewind as a reset and overcounted later recovery.

Each tier now independently ranks complete pairs before incomplete observations, newest first within each category. Both counters come from the same row. Gauge aggregation and closing memory/disk totals keep their existing ranks. A genuine lower closing counter still wins over earlier larger counters. No complete pair means the latest incomplete observation remains as before; no counter is invented.
