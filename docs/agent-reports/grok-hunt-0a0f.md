# Grok 排查记录（0a0f）

基线：`origin/main` `c26025ec`。没有再把 `main` 并进 #766–#772，没有空提交，没有改这些 PR 的自动合并。出口 agent、home agent、计费入库和发布工具的下一轮交给另一代理；本轮只收口已经核对过的缺陷。

## 结论

| ID | 区域 | 严重度 | 位置 | 说明 | 结论 |
|---|---|---|---|---|---|
| CP-CLUSTER-OPEN-RACE | 控制面 | 高 | `services/control-plane/src/telemetry/failure-clusters.ts:221` | 两个并发的「打开聚类」都读到没有 open 行，后一次 INSERT 撞上唯一约束，诊断上传 500 | 已在 #766 合入 |
| OPS-LEDGER-REVERSE-AMOUNT | 控制面 | 中 | `services/control-plane/src/ops/ledger.ts:317` | 冲正的原币金额在 CSV 合计里被符号乘了两次，800 的冲正加出 1600 | 已在 #767 合入 |
| WIN-WS-ONCONNECTED-WATCHDOG | Windows 应用 | 中 | `apps/windows/app/src/hooks/use-mihomo-ws-subscription.ts:161`（#768） | `connect()` 成功后看门狗仍武装到 `onConnected`；初始化失败时 epoch 已变，不再关闭并重连 | 已修，PR #768 开放。按队列规则不再更新该分支 |
| OPS-CURSOR-COLON | 控制面 | 中 | `services/control-plane/src/ops/http.ts:59`（#770） | 排序键含冒号（如 `a:b@example.com`）时 `encodeCursor` 500，客户列表翻页失败 | 已修，PR #770 开放。不再更新该分支 |
| WIN-UNICODE-EXIT-NAME | Windows 连接 | 高 | `apps/windows/app/src-tauri/src/tono/catalog_sync.rs:472`（#771） | 纯非 ASCII 出口名压缩成空串后互相相等，`next_catalog_exit` 离不开已死的中文节点 | 已修，PR #771 开放。不再更新该分支 |
| WIN-ADOPT-RETRY | Windows 更新 | 高 | `apps/windows/app/src-tauri/src/tono/commands/update.rs:290`（#772） | 继任进程里第二次 Adopt 仍得到 Allowed，自动恢复会再连一次 | 已修，PR #772 开放。不再更新该分支 |
| EXIT-AGENT-PARTIAL-INVENTORY | 出口 agent | 高 | `services/exit-agent/reconcile_and_report.py:1094` | 部分对账失败，或完整对账后缓存/计量校验拒绝，新增客户端不写入 `installedClients`。实时列表未知时，后续吊销漏掉该客户端 | 未修。#780 只修了完整对账后的 ACK 失败。已开 [#810](https://github.com/raydocs/tono/issues/810)。本轮不再改这个目录 |
| CP-QUOTA-CYCLE-INSERT-GAP | 控制面配额 | 中 | `services/control-plane/src/ops/quota.ts:307` | 关闭过期周期的 UPDATE 与插入新周期是两次写入。插入失败后下一轮没有旧 last 基线，跨界流量漏计 | 未修。#780 已让成功的新周期继承旧 last。已开 [#811](https://github.com/raydocs/tono/issues/811)。本轮不再改配额代码 |

## 本轮 PR

| PR | 状态 |
|---|---|
| #766 聚类并发打开 | 已合入 `main` |
| #767 账本冲正原币合计 | 已合入 `main` |
| #768 WebSocket 看门狗 | 开放，`mergeable=clean`。不追 main |
| #770 游标冒号 | 开放，`mergeable=clean`。不追 main |
| #771 非 ASCII 出口名 | 开放，`mergeable=clean`。不追 main |
| #772 更新收养重试 | 开放，`mergeable=clean`。不追 main |
| 本记录 | 文档 PR，自动合并 |

#780 已合入。它修了重启基线、ACK 失败后的库存，以及成功跨周期时的 last 继承。上表最后两行是它写明留下的缺口，本次只登记、不改代码。

## 假阳性（16）

1. 未列入名单的运维邮箱走 owner：测试写明的行为。
2. 已下发但未完成的设备动作会重放直到有结果：有意为之。
3. Trojan / VMess / SS 被准入拒绝：有意为之。
4. 客户列表的 etag 不含 cursor：etag 按完整 URL 计算。
5. etag 的初始时间只在同一秒内稳定：运维台不发送 `If-None-Match`，不会改变响应。
6. `pick_raced` 在样本含 hy2 时可能返回 hy2：没有调用方被证明会传入 hy2。
7. macOS `isPublicIPv4` 比 Windows 少若干 L8 特殊 /24：文档中的更严差异，不是目录故障。
8. 双栈上的 IPv6 RA 变动不会拆隧道：只有纯 IPv6 下一跳变化才算 moved。
9. 睡眠唤醒里 `pause && !lifts || automaticResumeHeldAfterRestart` 的优先级：符合「意外重启不自动重连」。
10. DoH 取第一个公网答案：解析器竞速的设计。
11. `direct_candidates.bytes_30d` 在分段写入时累加：日滚会用 `direct_candidate_daily` 覆盖，不是双计。
12. 空 `segmentId` 会跳过账本：日志入口传的是 `diagnostics_log_objects.id`，不是空串。
13. 目的键按制表符拆开：写入端不产生带制表符的主机名或节点名。
14. home agent 在本地总量已等于服务端水位、又弄丢 peer 基线时会重计：保存把总量和 peer 基线写在一起；服务端水位更高的丢状态路径已有回归。
15. `macos-release.yml` 的 `eval`：名字来自固定密钥列表，不是 PR 标题或分支名。
16. `deriveRoute` 把住宅流量标成直连：对照现有 macOS / Windows 写入形状和解析测试，没有证明。

按任务忽略、不算假阳性也不新开议题：#317、#4、#5、#409。#662 的 TUN 等待已有 #663。

## 没有继续做的范围

出口 agent 的部分库存、home agent 计量、计费入库（`traffic-parse` / `traffic-write` / `ingest*` / `replay`）、发布签名工具、sing-box 与 connect-bench：核对到上面已列出的结论后停止。这些目录的下一轮不在本记录里开工。`#742`、`#730`、`#744` 已占用 connect-bench 与 macOS sing-box 针，未改那些文件。
