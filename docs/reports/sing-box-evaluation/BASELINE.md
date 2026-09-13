# Stage A 固定基线 — 2026-09-13

**已构建 Tono adaptive Mihomo 的 Linux 实验等价物；没有构建或运行 sing-box。**
它保留产品的 upstream commit、依赖版本和 Tono patch，但不是 macOS/Windows 产品安装包，也没有 Linux 产品 fail-closed 认证。

## 仓库身份与修改边界

| 项目 | 实际值 |
|---|---|
| 仓库 | https://github.com/raydocs/tono |
| 初始位置 | `/home/user/workspace/repo` |
| 初始 branch / HEAD | `main` / `1d00b581dffdd98e84821c8789eb0c46b7a21bed` |
| 初始 `git status --short` | 空，exit 0 |
| 指定参考提交 | 与初始 HEAD 相等；`git cat-file -t` → `commit` |
| 祖先检查 | `git merge-base --is-ancestor 1d00b581dffdd98e84821c8789eb0c46b7a21bed HEAD` → exit 0 |
| 历史 | 初始 shallow；按仓库指令仅一次 `git fetch --quiet --unshallow origin`；没有 checkout/rebase/reset 到新 main |
| 实验 worktree | `/home/user/workspace/tono-stage-a-20260913` |
| 实验分支 | `experiment/sing-box-stage-a-20260913`，从指定参考提交创建 |
| 开始前远程只读检查 | open PR：0；open issue：#26、#4、#5。没有创建/关闭 issue |

独立审计报告来自同一固定提交，并由主实验线程复核。所有保留改动仅在
`tooling/experiments/sing-box-bench/` 与 `docs/reports/sing-box-evaluation/`。
产品目录、正式脚本、锁文件、CI、客户更新源不变。只创建本地实验交付 commit；依本次授权禁止 push、PR、tag、merge、部署。

## 内核身份：重新从仓库文件核对

两端 `core-identity.json` 内容相同，SHA-256 均为
`80a47ba8926038739765e3a50d0d128c047f17c93d65049bd465ed82b08c1c7a`。

| 字段 | 值 |
|---|---|
| Tono core | `v1.19.30-tono-gvisor-adaptive.1` |
| upstream tag | `v1.19.30` |
| upstream commit | `ac017cdd246ce8bd547653d927e7bf77d7ee73d5` |
| TUN module | **MetaCubeX** `github.com/metacubex/sing-tun v0.4.22` |
| module sum | `h1:6ARRJ2BIFD1u4r/DTMNcxaNuGyimfXEeUyD4iFJRaZs=` |
| compiler | `go1.27.1`；upstream `go.mod` 的 Go 1.20 是语言下限，不是本次编译器 |
| tags | `with_gvisor` |
| patch | `tooling/scripts/mihomo-adaptive/gvisor-adaptive-buffer.patch` |
| patch SHA-256 | `f33ee290cc979b739505777761b87f7933441e6bc94d0fc98bb75b42477f005b` |

Patch 只调整 gVisor TCP send/receive range 为 min 4096、default 32768、max 131072 bytes，保留 receive moderation；附带的真实 `NewGVisorStack` 选项测试通过。
没有使用 stock Mihomo 代替它，没有把 SagerNet `sing-tun` 混入这个模块图。

## 实际 Linux 构建

入口：`tooling/experiments/sing-box-bench/build_baseline.py`。没有调用产品安装脚本。

```sh
python3 tooling/experiments/sing-box-bench/build_baseline.py \
  --go /tmp/tono-stage-a-20260913/go/bin/go \
  --output /tmp/tono-stage-a-20260913/build-02
```

原始构建证据：`/tmp/tono-stage-a-20260913/build-02/{manifest.json,build.log,build-info.txt}`。
重新运行必须使用新的 output 目录。第一次构建因实验脚本未给复制后的 module 根目录增加写权限而失败；修复实验脚本后 build-02 成功，未改 patch/依赖。

- 官方 Go archive：`https://go.dev/dl/go1.27.1.linux-amd64.tar.gz`，70,553,950 bytes。
- 官方下载元数据与本地 SHA-256 校验一致：`63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445`。
- `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOAMD64=v2 GOMAXPROCS=4 GOTOOLCHAIN=local`。
- `go test -mod=readonly -tags with_gvisor -run '^TestTonoAdaptiveGVisorTCPBuffers$' -count=1 .` → exit 0。
- `go build -mod=readonly -tags with_gvisor -trimpath`，链接参数：

```text
-X github.com/metacubex/mihomo/constant.Version=v1.19.30-tono-gvisor-adaptive.1
-X github.com/metacubex/mihomo/constant.BuildTime=2026-09-13T00:00:00Z
-w -s -buildid=
```

固定 BuildTime 是实验复现参数，不冒充产品构建时刻。输出：

```text
Mihomo Meta v1.19.30-tono-gvisor-adaptive.1 linux amd64 with go1.27.1 2026-09-13T00:00:00Z
Use tags: with_gvisor
```

二进制：`/tmp/tono-stage-a-20260913/build-02/mihomo-tono-linux-amd64`。
SHA-256：**`c685870dc7b97014ac2044013cdbe83d8fedbf9da238b9f59dc64c12933d88a4`**。

Upstream `go.mod` SHA-256：`944b5c26fc12aec517a436d9204f034b513269b46ee66b900ba0855c9b53e9f3`。
Upstream/build 后 `go.sum` 均为 `39e3b062203a576c15c217de36a0e82589e0deedd2225363554214bebbc7cdbf`。
源码 worktree 的唯一 diff 是实验 `go.mod` 添加本地已打补丁 sing-tun 的 replace；`go.sum` 未变。完整 `go version -m` 留在仓库外。

## 环境身份

Debian 12、Linux `6.1.158+`、x86_64、8 vCPU、Intel Xeon 2.60 GHz、KVM。
物理可见内存约 16 GiB；workload cgroup `memory.max=15032385536`（14 GiB）。
根盘 64 GB，预检约 56 GB 可用。cgroup `cpu.max=max 100000`；可读 throttling 和 `/proc/stat` steal。

初始工具：Rust/Cargo 1.95.0、Node v24.18.0、npm 11.16.0、Python 3.11.6；Go 不在 PATH。
实验临时安装固定 Go 1.27.1；为现有 MSRV 1.98 的可移植测试安装 Rust 1.98.1（未改默认工具链或锁文件）。
`tc` 实际在 `/usr/sbin/tc`；新增 tcpdump 4.99.3。详细权限/网络事实见 [CAPABILITIES.md](CAPABILITIES.md)。
