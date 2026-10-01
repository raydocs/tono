# W2 Grok agents hunt（2026-09-30）

Hunter: Grok 4.7。槽位 W2-grok-agents。基线 `origin/main` `50bbbbf0`。范围：exit-agent、home-agent、remote/provision、计费入库（traffic-parse/write、ingest、hooks、limits、replay）、发布/签名工具与六个 workflow、sing-box / mihomo / connect-bench。

旧代理 `bc-0a0f053a` 的开放工作是 Windows/ops（#768、#770、#771、#772）和文档 PR（当时的 #814），不是这五个目录的修复。它把未修的出口库存缺口记成 #810，把配额周期插入失败记成 #811。本轮修了 #810。#811 在 `ops/quota.ts`，不在本槽文件列表里，不重复开题、不改。

没有改客户机路由、TUN、PF、WFP、DNS 或 kill switch，所以修复 PR 都没有 `needs-hardware`，也没有 `ui-review`。#838 在 `ci-gate` 通过后已用 merge commit 合入。#842、#845、#853 在 #838 合入后落后于 main；每次打开 auto-merge 后，账号 `raydocs` 大约 15 秒内会关掉。本轮结束时这三条没有挂着 auto-merge。按仓库约定，落后分支由合并队列的另一执行者更新，这里没有为了追 main 再推一次空提交。

## 结论表

| ID | 区域 | 严重度 | 文件:行 | 一句话 | 结论 |
|---|---|---|---|---|---|
| EXIT-AGENT-PARTIAL-INVENTORY | E1 | P1（中·推导） | `services/exit-agent/reconcile_and_report.py` `reconcile` 失败抛出；`run_once` 原先在待报时钟检查之后才写库存 | 对账已经装上客户端，随后本轮拒绝，磁盘库存不更新；下一轮列不出 inbound 时吊销会漏掉它 | 已合 [#838](https://github.com/raydocs/tono/pull/838)，Fixes #810。无额外标签 |
| PROVISION-REPO-ROOT | E2 | P2（低·推导） | `tooling/scripts/provision-tono-node.py` `REPO = parents[1]` | 「必须在仓库外」只排除了 `tooling/`，`services/` 或 `apps/` 下 0700 目录能放过私钥路径 | 已修 [#842](https://github.com/raydocs/tono/pull/842)。无额外标签。落后于 main 时 auto-merge 被关掉 |
| MIGRATE-CURRENT-RESTORE | E2 | P1（中·推导） | `tooling/scripts/remote/migrate-node-to-release-layout.sh` 原 `mv current` 之后的裸 `ln` | `ln` 失败时 `set -e` 退出，`current` 已经挪走，该出口没有二进制 | 已修 [#845](https://github.com/raydocs/tono/pull/845)。无额外标签。落后于 main 时 auto-merge 被关掉 |

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
| [#838](https://github.com/raydocs/tono/pull/838) `hunt/grok-agents-exit-inventory-2c38` | 已合入（merge commit） | 无 |
| [#842](https://github.com/raydocs/tono/pull/842) `hunt/grok-agents-provision-repo-path-2c38` | 已请求；落后于 main 时被 `raydocs` 关掉 | 无 |
| [#845](https://github.com/raydocs/tono/pull/845) `hunt/grok-agents-migrate-current-2c38` | 已请求；落后于 main 时被 `raydocs` 关掉 | 无 |
| [#853](https://github.com/raydocs/tono/pull/853) `hunt/grok-agents-report-2c38` | 已请求；落后于 main 时被 `raydocs` 关掉 | 无。仅文档 |

## 2026-10-01 续查

四份排查笔记回来之后又对过当前 `main`。能用失败测试钉住、而且现有 PR 没覆盖的，各开了一条修复。文档 PR 不挂 auto-merge。#842 的 auto-merge 由队列管理，本轮没有再打开或关掉。#845 与 #853 已合入。

| ID | 区域 | 严重度 | 文件:行 | 一句话 | 结论 |
|---|---|---|---|---|---|
| HOME-AGENT-REPORT-400-WEDGE | E2 | P1（中·推导） | `services/home-agent/report_example.py` `deliver_pending` | 一条永久拒绝的用量报告挡住后面所有账号 | [#899](https://github.com/raydocs/tono/pull/899)。auto-merge 已打开一次 |
| NODE-QUOTA-ZERO-BASELINE | C4 调用方 | P1（中·推导） | `services/control-plane/src/ops/handlers/nodes-profile.ts` 保存配额 | 没有接口采样时基线记成 0，下一次累计读数整段计入节点配额 | [#904](https://github.com/raydocs/tono/pull/904)。与 #811 / #852 不是同一个缺口。auto-merge 已打开一次 |
| TRAFFIC-POLICY-API-PIN | T1 | P2（中·推导） | `tooling/scripts/publish-traffic-policy.mjs` `--api` | 管理员令牌会发给任意源站 | [#908](https://github.com/raydocs/tono/pull/908)。auto-merge 已打开一次 |
| TCP-TUNE-FALSE-SUCCESS | E2 | P2（低·推导） | `tooling/scripts/remote/tune-tono-tcp.sh` 文本一致就退出 | drop-in 已写上但内核仍是旧值时仍报成功 | [#910](https://github.com/raydocs/tono/pull/910)。auto-merge 已打开一次 |
| MIGRATE-STALE-CONFIG | E2 | P1（中·推导） | `tooling/scripts/remote/migrate-node-to-release-layout.sh` 测试前的那一次拷贝 | 测试期间 hub 改写的配置留在备份里，新链接仍是旧配置 | [#913](https://github.com/raydocs/tono/pull/913)。与已合入的 #845 是不同段落。auto-merge 已打开一次 |

续查本地验证：home-agent 25 tests OK（修复前该测试以 HTTP 400 失败）；配额测试修复前 `counter_in_last` 为 0，修复后通过，`ops-quota` 11 passed，本机 Node 22；另外三条 Python unittest 都是修复前 FAIL、修复后 OK。没有对真实节点做开通、迁移或 sysctl。

续查里不再开题的笔记：

- 出口代理在 #838 之后，[Hunt exit-agent bugs](bc-ef986c7b-9069-5af6-8c6c-4d93e2cb99ef) 没有新的可修缺陷。
- 六份计费入库文件不写客户 `usage_bytes`。#811 仍由 #852 处理，不重复改。
- macOS 更新包只核对 Content-Length：客户端安装前仍验签名。与正文里同一条否决。
- Windows 非 immutable 发布只警告：脚本写明旧发布没有该设置。没有改成失败。
- Sparkle 手动发布不跑 `verify-release-gate.sh`，以及 `--expected-host` 可以改下载地址：本轮没有重新证明到能开题的程度，没有开 issue。

## 2026-10-01 T2 / T4

基线 `origin/main` `b341164b`。T1 发布脚本留给另一位代理（含 #908 和上面两条未证明的 Sparkle 笔记），这里没有改。没有新开 GitHub issue。文档 PR 不挂 auto-merge。修复 PR 各打开一次 auto-merge，没有直接合并。

| ID | 区域 | 严重度 | 文件:行 | 一句话 | 结论 |
|---|---|---|---|---|---|
| CONNECT-BENCH-ZERO-HANDSHAKE | T2 | P2（中·已确认） | `tooling/perf/connect-bench/bench.py` `limit_failures` | 正数握手上限只拒绝更大的数，0 次 Reality 握手仍算通过 | [#948](https://github.com/raydocs/tono/pull/948)。auto-merge 已打开一次。毫秒仍是上界；mihomo 冷 DoH 的 1 次仍落在上限 2 里 |
| T4-REACHABILITY-TOKEN | T4 | P3（低·已确认） | `tooling/scripts/test-suite-reachability.sh` 路径搜索 | `test-wired.sh.skip` 含有套件路径时，注册检查退出 0 | [#953](https://github.com/raydocs/tono/pull/953)。auto-merge 已打开一次。与 #823 的 SIGPIPE 不是同一处。当前 workflow 没有这种假引用 |

### 请代为开题（本轮没有开 issue）

| 建议 ID | 文件 | 证据 | 为何没改 |
|---|---|---|---|
| PEER-AUTH-CI-SKIP | `tooling/scripts/test-helper-peer-authorization.sh` 找不到 `Apple Development: Ruirui Wan` 时 `exit 0` | [macos-ci 36792958720](https://github.com/raydocs/tono/actions/runs/36792958720) 的 `policy-tests` 打出 `SKIP: no Apple Development identity for the Tono team`，整次运行仍是 success。`macos-ci.yml` 与 `macos-release.yml` 都跑这个脚本 | 托管的 `macos-26` 上没有这张开发证书。把跳过改成失败会让每次 macOS CI 变红，直到证书装上。这里不能装证书 |

这条会跳过的用例包括：正确身份放行、ad-hoc 拒绝、错误 bundle id 拒绝、`get-task-allow` 拒绝。

### 本地验证

- `python3 tooling/perf/connect-bench/test_check.py`：修复前失败（`vless/tono-fixed/handshakes` 不在失败列表），修复后 1 test OK。对照运行 [36755690366](https://github.com/raydocs/tono/actions/runs/36755690366)：mihomo `dns_handshakes` 为 1，sing-box 为 2，所以上限没有改成必须相等。完整 `bench.py --check` 未跑。
- `node --test tooling/scripts/tests/suite-reachability.test.mjs`：修复前新用例实际退出码 0，修复后 2 tests OK。对仓库跑 `test-suite-reachability.sh`，改前改后都退出 1，名单相同。
- `node --test tooling/scripts/tests/ci-gate-changes.test.mjs`：7 passed。
- `with-slot.sh tono-t4 1 --`：`false` 为 1，`true` 为 0，`exit 3` 为 3。
- `core-helper/*.swift` 与 `build-core-helper.sh` 的编译列表一致。`CONTRACT.sha256` 为 `4.52.8 84af09c78bed94092906e57d4551fdf79d73f02d526b54c9df86adc19e25389b`。没有跑 `swiftc`。
- 没有下载或替换 sing-box / mihomo 二进制，没有部署，没有写生产 D1。

### 这轮否掉的

考察 16 条。2 条已修。1 条留给上面开题。其余 13 条否掉：

| 假设 | 为何否掉 |
|---|---|
| 握手次数必须等于上限 | 成功的基准运行里 mihomo 冷 DoH 是 1，上限是 2。改成相等会把绿的运行打红 |
| sing-box prepare/verify 可以装上未核对的二进制 | 清单哈希、二进制哈希、源提交、脏树、工具链不一致即失败 |
| `certify.py` 在 Go 省略 ldflags 时会换掉已发布字节 | 已发布字节另有哈希针；ldflags 只在 Go 写进二进制时才比对 |
| mihomo adaptive 不核对产物哈希就会装错包 | 先核对上游提交，补丁和 `go test` 失败即停，再核对 Mach-O/PE 与版本串。输出哈希不钉死是因为构建写入当前时间 |
| gvisor 缓冲无界 | 已记录，上限 128KiB |
| connect-bench 解压后的缓存二进制可被调包 | 归档 SHA-256 会核对。CI 工作区是空的。同一次失败的解压会让该步失败 |
| helper 从漏掉的 Swift 文件编出来 | 当前目录和编译列表一致，合同哈希与现算一致。没有未列出的文件 |
| `with-slot.sh` 把失败收成 0 | 退出码原样传出 |
| `records.mjs` 丢掉没有表格的发现分片 | 当前 `docs/findings.d` 没有空分片。它不是 CI 门 |
| `test-macos-all.sh` 在有跳过时退出 0 | 脚本写明跳过名单会打印，且没有 workflow 调用它 |
| D1 备份在 wrangler 退出 0 时上传空文件 | 小于 10 KiB 即拒绝 |
| 策略签名检查漏掉中间失败 | 每一步都是 `\|\| fail` |
| 注册脚本对 main 变红是这次引入的 | 改前改后名单相同。`services-ci` 用 `*.test.mjs` 通配符跑这些 mjs；脚本不把通配符当成逐文件路径，所以多报未接线。这是过严，不是假绿 |

`tooling/scripts/tests/test_provision_tono_node.py`、`test_check_node_in_fleet.py`、`provision-reality-node.test.rb` 没有出现在 workflow 的 `run` 里。注册脚本因此报它们未接线。这是没跑，不是跑了还报成功。本轮没有把它们接进 CI。

### 读过的范围

T2：`sing-box/certify.py` 的构建与校验、`prepare-macos-sing-box.sh`、`verify-macos-sing-box.sh`、`build-mihomo-adaptive.sh` 与 gvisor 补丁、`connect-bench/bench.py` 与 `baseline.json`。T4：`test-*.sh` 的 `set -e` / `SKIP` / `exit 0`、`records.mjs`、`with-slot.sh`、`build-core-helper.sh`、注册检查、peer authorization、策略签名合同、D1 备份。`remote/` 下已由 #910 / #913 覆盖的脚本没有再改。发布与签名脚本没有打开。

