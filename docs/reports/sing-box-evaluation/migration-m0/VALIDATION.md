# M0 离线验证记录

执行日期 2026-09-14；Linux Orb `6.1.158+ x86_64`，Python 3.11.6，jq 1.6。
Tono 起点是 [a605306a](https://github.com/raydocs/tono/commit/a605306a1d41b93035338bd44e58635b5659e7df)；
验证输入为本批提交内的 candidate/reference，下面记录实际字节哈希。
**没有运行 core `run`，没有创建 TUN、监听器、修改 DNS/路由/过滤器，也没有连接 reference 的公网地址。**

## 实际结果与证据边界

| 检查 | 退出码 / 结果 | 可以证明什么 |
|---|---|---|
| 固定源码 HEAD + 工作树 + go.mod/go.sum | 0 / 与 manifest 一致，源码干净 | 本次检查没有换源码/依赖 |
| 保留 B 二进制 SHA、Go build info | 0 / 与 manifest 一致 | 实际解析器为固定 commit、Go1.27.1、linux/amd64/v2、CGO=0、四个约定 tags、vcs.modified=false |
| Windows reference 的 `core check -c` | 0，无输出 | 在 Linux 上解析/构造成功；**不是 Windows 运行验证** |
| 仅把 TUN 名改为 utun199 的 reference `check` | 0，无输出 | 在 Linux 上解析/构造成功；**不是 macOS 运行验证** |
| 把第一个 outbound 的 Reality public_key 改成 `invalid` | 1，`initialize outbound[0]: invalid public_key` | 非法 key 解析失败；**不是错误 pin 握手测试** |
| 0.1 秒 watchdog 包住 5 秒 sleep | 124，符合预期 | 超时独立于成功；这是 watchdog 对照，不伪称 core 挂死复现 |
| Python fixture 自洽性检查 | 0 / PASS | 第二节点选择/端点、数组顺序、flow 缺省、secret/key 长度、DNS/fake 池隔离、规则顺序与约定一致 |
| staged diff / Markdown 相对链接检查 | 0 / clean | 只包含本目录，不含产品、秘密或大型产物 |

本批无非预期验证失败。负样本的非零退出是预期结果，未记作连接成功。
fixture 自洽检查不是 Swift/Rust emitter 回归；两个 emitter 尚未编写。
不用 Linux `check` 替代 #171、#26 或 SHIP_PLAN 的真机门禁。

## 固定身份与实际输入哈希

| 对象 | SHA-256 |
|---|---|
| `candidate.json` | `9e50077ea88adcaf17c8b6c8344868f651ce4af9b576135669a8de02c2f101de` |
| `reference.json` | `f9977c06ccddf1001a77f0fe6ec13c5ffce4c053f8b721de908501fdf04ddbc0` |
| jq 提取 Windows runtime | `85723e709aef8b6925a2aca6c150805bcec0c824308fb61a7d85c61f9bfa712e` |
| jq 提取 macOS runtime | `1c7451f41f594331ef34e984ce85057524b96c6cab876ffd5a073f08f019aca3` |
| 实际使用的 B Linux core | `cd2ba002e1282da29674107cc503285dc8fa7026bf01fcc40d314bc10ab749df` |

候选源码是 [93fff595](https://github.com/SagerNet/sing-box/commit/93fff5954390367dd456cad3cbd79be54f8b941f)，
SagerNet sing-tun `v0.9.4-0.20260912075549-869f0a4d76af`，与 MetaCubeX 依赖不是同一体系。
实际二进制 banner 仍是历史实验字符串 `1.14.0-alpha.0-experiment.93fff595`；Go build info 的
`vcs.revision`、模块以及文件 SHA 与固定候选一致。没有把 banner 当正式候选版本。
`candidate.json` 中 `1.15.0-alpha.3-tono-m1.1` 是 **M1 待构建标签**；`m1_artifacts=[]`，
本批没有构建、更名或替换原生二进制。M1 新产物必须重新记录 SHA，不能套用本表。

## 可复现命令：只执行 check，不启动网络

在本批提交的仓库根目录运行 Bash。以下 CORE/SOURCE/GO 为本 Orb 留存路径；其他机器需先
取得相同来源与哈希的产物，缺少时停止，不下载 latest 或以 stock Mihomo 替代。
fixtures 中的 UUID/secret 是公开合成值，Reality public key 是公开 RFC 7748 测试向量；
IP 是满足现有公网 IPv4 准入的 **仅解析示例**，不是获授权测试节点，严禁以此配置 `run`。

```bash
set -euo pipefail
DIR=docs/reports/sing-box-evaluation/migration-m0
CORE=/tmp/tono-stage-b-20260913/build-01/sing-box-linux-amd64
SOURCE=/tmp/tono-stage-b-20260913/sing-box
GO=/tmp/tono-stage-a-20260913/go/bin/go
test "$(git -C "$SOURCE" rev-parse HEAD)" = "$(jq -r .source.commit "$DIR/candidate.json")"
test -z "$(git -C "$SOURCE" status --porcelain)"
test "$(sha256sum "$CORE" | cut -d' ' -f1)" = "$(jq -r .retained_check_binary.sha256 "$DIR/candidate.json")"
test "$(sha256sum "$SOURCE/go.mod" | cut -d' ' -f1)" = "$(jq -r .source.go_mod_sha256 "$DIR/candidate.json")"
test "$(sha256sum "$SOURCE/go.sum" | cut -d' ' -f1)" = "$(jq -r .source.go_sum_sha256 "$DIR/candidate.json")"
"$GO" version
"$GO" version -m "$CORE"
"$CORE" version --name

TMP=$(mktemp -d /tmp/tono-m0-check.XXXXXX)
trap 'rm -rf -- "$TMP"' EXIT
jq '.windows_runtime' "$DIR/reference.json" > "$TMP/windows.json"
jq '.windows_runtime | .inbounds[0].interface_name = "utun199"' "$DIR/reference.json" > "$TMP/macos.json"
jq '.windows_runtime | .outbounds[0].tls.reality.public_key = "invalid"' "$DIR/reference.json" > "$TMP/bad-key.json"
for platform in windows macos; do
  sha256sum "$TMP/$platform.json"
  timeout --signal=TERM --kill-after=2s 15s "$CORE" check -c "$TMP/$platform.json"
  echo "$platform exit=0"
done
set +e
timeout --signal=TERM --kill-after=2s 15s "$CORE" check -c "$TMP/bad-key.json"
rc=$?
set -e
echo "invalid-key exit=$rc"
test "$rc" -eq 1
set +e
timeout --signal=TERM --kill-after=2s 0.1s sleep 5
rc=$?
set -e
echo "watchdog exit=$rc"
test "$rc" -eq 124
echo 'PASS: 2 positive core checks, key rejection, watchdog classification'
```

临时目录由 EXIT trap 删除，包括失败/中断后的普通 shell 退出；timeout 对所启动命令发送
TERM，2 秒后仍不退出才 KILL。不操作其他进程，不使用全局 cleanup。未保留新的大型原始日志。

## 冻结选择的源码依据

以下是源码证据，不是原生实测：

- [check](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/cmd/sing-box/cmd_check.go#L29-L43)
  调用 `box.New`/`Close`，不调用 `Start`；所以不能以 check 证明系统网络已建立。
- [stack 默认分支](https://github.com/SagerNet/sing-tun/blob/869f0a4d76af/stack.go#L51-L70)
  `""`/`"go"` 调用 `NewGo`；省略 stack 并不是回退到旧 system 栈。
- [Windows DNS/strict-route](https://github.com/SagerNet/sing-tun/blob/869f0a4d76af/tun_windows.go#L76-L198)
  原生 DNS 设置受 DNSMode 约束，额外 WFP 过滤受 StrictRoute 约束；与 Tono 保护的集成仍待 M2。
- [PUT configs](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/experimental/clashapi/configs.go#L52-L71)
  不能应用整份配置；[CORS 默认](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/experimental/clashapi/server.go#L101-L114)
  空 allow-origin 变成 `*`，因此 reference 显式设置有限 Origin，不把 CORS 当认证。
- [macOS node admission](../../../../apps/macos/Tono/Core/Configuration/ConfigPipeline+Nodes.swift) 的
  `validatedOwnedNodes`/`validatedOwnedNode`（116–217 行）和
  [Rust node admission](../../../../apps/windows/crates/tono-core/src/node.rs) 是继续使用的来源；
  v1 只增加 profile 拒绝条件，不改这两处的产品行为。
- [macOS DIRECT metadata](../../../../apps/macos/Tono/Core/ConfigPipeline.swift) 的
  `ManagedDirectRuntimePolicy`（60–104 行）、[Rust DirectPlan](../../../../apps/windows/crates/tono-core/src/config.rs)
  （337–370 行）以及 [完整 policy](../../../../apps/windows/crates/tono-core/src/policy.rs)（314–352 行）
  说明只检查空 JSON 列表不足以断言没有默认/派生要求。

## 尚未执行与交审门

- **M1 待执行：** 两端 emitter、profile 拒绝负样本、脱敏检查、新固定核心构建及逐目标 manifest。
  本批没有证明任何产品拒绝代码已经存在。Puck 分派后，各工作包独立提交和给出对应 SHA 的测试。
- **M2/native 待执行：** 原生 DNS/PF/WFP、PID/controller/TUN 所有权、保护重建、安装升级恢复、
  真实 Connected 和 GUI。Linux 无法替代；Mac Studio/Windows 验收，MacBook 不做原生编译。
- **仍为完整迁移缺口：** Hy2 DER 认证、DIRECT 生效读回、家宽与其他路由、双 DoH 冗余。
  v1 不支持时拒绝，不凭 parser 成功宣布等价，也不发布或切客户更新源。
- **下一门槛：** Puck 以本批冻结 SHA 分派 M1；M1 代码与拒绝证据交审通过后才进入 M2。
  需要更改此合同的工作回到单一 owner，以独立版本/提交审阅，不允许平台私自变更。
