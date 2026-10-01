# W2 Grok agents hunt（2026-09-30）

Hunter: Grok 4.7。槽位 W2-grok-agents。基线 `origin/main` `50bbbbf0`。范围：exit-agent、home-agent、remote/provision、计费入库（traffic-parse/write、ingest、hooks、limits、replay）、发布/签名工具与六个 workflow、sing-box / mihomo / connect-bench。

旧代理 `bc-0a0f053a` 的开放工作是 Windows/ops（#768、#770、#771、#772）和文档 PR（当时的 #814），不是这五个目录的修复。它把未修的出口库存缺口记成 #810，把配额周期插入失败记成 #811。本轮修了 #810。#811 在 `ops/quota.ts`，不在本槽文件列表里，不重复开题、不改。

没有改客户机路由、TUN、PF、WFP、DNS 或 kill switch，所以三个修复 PR 都没有 `needs-hardware`，也没有 `ui-review`。都已 `gh pr merge --auto --merge`。

## 结论表

| ID | 区域 | 严重度 | 文件:行 | 一句话 | 结论 |
|---|---|---|---|---|---|
| EXIT-AGENT-PARTIAL-INVENTORY | E1 | P1（中·推导） | `services/exit-agent/reconcile_and_report.py` `reconcile` 失败抛出；`run_once` 原先在待报时钟检查之后才写库存 | 对账已经装上客户端，随后本轮拒绝，磁盘库存不更新；下一轮列不出 inbound 时吊销会漏掉它 | 已修 [#838](https://github.com/raydocs/tono/pull/838)，Fixes #810。auto-merge 开。无额外标签 |
| PROVISION-REPO-ROOT | E2 | P2（低·推导） | `tooling/scripts/provision-tono-node.py` `REPO = parents[1]` | 「必须在仓库外」只排除了 `tooling/`，`services/` 或 `apps/` 下 0700 目录能放过私钥路径 | 已修 [#842](https://github.com/raydocs/tono/pull/842)。auto-merge 开。无额外标签 |
| MIGRATE-CURRENT-RESTORE | E2 | P1（中·推导） | `tooling/scripts/remote/migrate-node-to-release-layout.sh` 原 `mv current` 之后的裸 `ln` | `ln` 失败时 `set -e` 退出，`current` 已经挪走，该出口没有二进制 | 已修 [#845](https://github.com/raydocs/tono/pull/845)。auto-merge 开。无额外标签 |

没有留下已证实但未修的缺陷，所以本轮没有新开 GitHub issue。#4、#5、#780、#789、#811、#816 沿用已有记录。

## 本地验证

- `python3 services/exit-agent/test_reconcile_and_report.py`：修复前两条新测试失败（库存仍是旧列表），修复后 101 tests OK。
- `python3 tooling/scripts/tests/test_provision_tono_node.py`：修复前仓库内路径的错误是 `path must be owner-only`，修复后 20 tests OK。
- `python3 tooling/scripts/tests/migrate_node_layout_test.py`：修复前 `current` 不是目录，stderr 为 `ln: ... File exists`；修复后 1 test OK。`sh -n` 通过。
- 未部署出口，未对真实 VPS 做开通或迁移，未跑发布/签名脚本，未跑 Swift / Windows cargo。

## 假阳性

考察 41 条假设。3 条已修。6 条是已有记录、不重复开题（#780 的 ACK 路径、议题 #4、议题 #5、#811、#789、#816）。其余 32 条否掉：

| 假设 | 为何否掉 |
|---|---|
| 从未有库存且不能列出用户时不删除客户端 | 注释写明这是避免误删付费用户 |
| 启动标记读不到就忘掉旧标记 | 避免同一次重启折两次、重复计费 |
| `read_counters` 把非整数收成 0，下一轮多计 | xray 统计是整数；没有证据会吐出浮点 |
| 用量时钟超前就拒绝上报 | 故意少计，避免 400 丢掉增长；吊销已经先跑 |
| 400 回滚 `userTotals` 后再送累计值会双计 | 服务端 v2 只加增量 |
| home-agent 服务器水位更高时 delta 为 0 | 故意避免状态丢失后双计 |
| 有待报就返回、当轮不 metering ack | 下一轮非重放会 ack |
| 已吊销设备仍留在 Tailscale 映射里 | agent 不控制 ACL；继续计费不是放行 |
| 多个无 email 客户端都标 `shared-legacy` | `enable` 脚本先 `xray run -test`，失败会恢复。没有证据表明 xray 接受重复 email |
| provision 不发布客户目录 | 脚本写明不发布 |
| Komari 安装被拒绝 | 故意未实现 |
| Xray zip 路径穿越 | 只读取名为 `xray` 的成员 |
| 流量后段写入失败少计 | 代码写明少计比双计便宜；账本行在第一块 |
| 空 `segmentId` 会双计 | `afterLogSegment` 只在非重复上传时用 `stored.id` |
| `connection_opened` 与 `connection` 双计配额 | 分析链不是配额账本；macOS 的 opened 事件没有字节字段 |
| 目的键里的制表符串列 | 只影响同一用户的分析行 |
| `intField` 超过 2^53 | 分析计数精度，不是配额 |
| `replay.ts` 重放账单 | 那是节点判决重放 |
| `ingest.ts` 租约被短令牌调用 | 令牌长度至少 32，否则 503 |
| `direct_candidates` 30 日滚动双计 | 重算是替换，测试写明不累加 |
| 六个发布 workflow 把 PR 标题插进 `run` 或使用 `pull_request_target` | 输入走 env；没有 `pull_request_target` |
| `upload-release-asset` 只核对 Content-Length 就能换掉更新包 | promote 会下载并验签名；这不是客户更新链的洞 |
| 公证脚本失败仍装订 | 非 Accepted 即非零退出 |
| `verify-release-gate` 放过未签名包 | 检查 hardened runtime 和 Developer ID |
| `windows-package-components` 放过重复 exe | 拒绝链接、大小写重复路径和非同一份 next exe |
| `publish-managed-catalog` 弄丢占位符或放过 hy2 `skip-cert-verify` | 文本拼接；hy2 要求指纹且 `skip-cert-verify` 为 false |
| `desktop-update-sign` 能从 PR 发布 | 权限是 `contents:read` / `actions:read`，且只接受 `workflow_dispatch` |
| sing-box prepare/verify 哈希可以不一致 | 不一致即失败 |
| `certify.py` 是产品准入 | 它是冻结的 M0 来源证明，先哈希再解析 |
| mihomo gvisor 缓冲无界、会挂死机器 | 上限 128KiB |
| 应改 #730 / #744 / #742 / #749 里的 pin、emitter、bench | 那些分支已占用，本轮只看 main |
| xray 重启过程中应把当时的库存写成已确认 | 那一代 API 用户可能刚被重启丢掉；不把不明的一代写成库存 |

## 没做完的部分

- T2：`certify.py` 后半、`connect-bench` 内部、mihomo 补丁以外的脚本没有逐行读完。main 上没有再发现要单独开 PR 的行为缺陷。
- T1：`publish-macos-appcast.mjs` 和 `release-macos.sh` 没有逐行读完。签名校验和门禁调用读过，没有发现放宽门禁的改动。
- C4：配额折算在 `index.ts` / `quota.ts`，不在指定文件里。#811 已有议题。
- E2：`provision-reality-node.rb` 的 hy2 回滚读过关键段。按任务要求没有对真实节点做开通或发布。

## PR

| PR | auto-merge | 标签 |
|---|---|---|
| [#838](https://github.com/raydocs/tono/pull/838) `hunt/grok-agents-exit-inventory-2c38` | 开，merge commit | 无 |
| [#842](https://github.com/raydocs/tono/pull/842) `hunt/grok-agents-provision-repo-path-2c38` | 开，merge commit | 无 |
| [#845](https://github.com/raydocs/tono/pull/845) `hunt/grok-agents-migrate-current-2c38` | 开，merge commit | 无 |
