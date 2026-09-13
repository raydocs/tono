# Stage A 已执行结果

**当前没有足够证据升级内核。已建立可复现的 patched-Mihomo Linux 构建和隔离 SOCKS 基线，确认两个产品源码问题；未进行 sing-box 对比。**

## 已运行并通过

| 范围 | 精确命令（仓库根目录） | 决定性结果 |
|---|---|---|
| 固定Tono内核 | `python3 tooling/experiments/sing-box-bench/build_baseline.py --go /tmp/tono-stage-a-20260913/go/bin/go --output /tmp/tono-stage-a-20260913/build-02` | exit0，BUILT；同 upstream/MetaCubeX依赖/Tono patch；真实gVisor选项回归通过 |
| 产品可移植FSM | `CARGO_TARGET_DIR=/tmp/tono-stage-a-20260913/cargo-target cargo +1.98.1 test --manifest-path apps/windows/Cargo.toml --locked -p tono-core --lib connection::tests -- --nocapture` | **22 passed，0 failed**；真实共享库，不是复制状态机 |
| 产品节点准入 | 同上，将filter改为`node::tests` | **42 passed，0 failed**；含Reality/Hy2准入、拒绝skip-cert-verify/非法端点 |
| 实验工具自测 | `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tooling/experiments/sing-box-bench -p test_bench.py -v` | **3 tests，OK**；exit7、超时、中断、空消息异常不会记成功；root子namespace超时回收 |
| 基线smoke | `python3 tooling/experiments/sing-box-bench/bench.py smoke --output /tmp/tono-stage-a-20260913/smoke-01 --run-id ta-smoke-01 --binary /tmp/tono-stage-a-20260913/build-02/mihomo-tono-linux-amd64` | exit0；15/15测量请求正确；2个负向样本正确失败 |
| 最终工具复核 | 上条output/run-id换成`smoke-final`/`ta-smoke-final` | exit0；新增root watchdog后的同一负载/负向控制仍通过，未合并进下表统计 |
| 独立profile轮次 | 同smoke入口，mode=`profiles`、output=`profiles-01`、run-id=`ta-profiles-01` | exit0；5种pprof取回且解析成功；详见下文限制 |
| A1能力 | preflight-02 | veth、TUN双向包I/O、TCP/UDP合成服务、隔离抓包通过；netem失败，未吞掉 |

**可移植库测试不覆盖 Tauri外层锁、Windows Service/WFP、Swift helper/PF 或安装机更新。**
两个新发现来自完整源码调用链，不是上述64个测试的失败复现；原生故障注入仍待做。

## 小规模基线到底测了什么

`SOCKS5 → Mihomo DIRECT → 同一namespace内的合成HTTP服务`。
TUN和DNS在smoke配置中关闭；没有Reality/Hy2，没有真实用户、外部业务请求、TLS握手或第三方目标。

- 同宿主本地链路：client/curl、Mihomo、Python server共享CPU和调度器，不能代表公网/国内运营商/独立服务器。
- Core `GOMAXPROCS=2`；并发1，MTU为loopback默认值（不是产品TUN MTU）。没有pin CPU独占。
- 单次请求最多返回固定合成正文；curl显式max-filesize与max-time；无重试。正向15次合计88,320 bytes。
- 1次预热 + **同一进程内3批×5次**；不是阶段B要求的3个独立测量轮次。
- 所有外层耗时用`time.monotonic_ns`；TTFB使用curl计时。记录的是应用TTFB，不拆分代理内部握手。
- 没有与编译或其他压测并跑；profile单独启动Core。全部网络负载远小于30分钟预算。

smoke-01统计（包含所有15个测量样本；无失败可删）：

| 同进程批次 | 样本 / 成功 | 应用TTFB min / median / max (ms) |
|---|---|---|
| 1 | 5 / 5 | 1.190 / 1.279 / 1.418 |
| 2 | 5 / 5 | 1.059 / 1.162 / 1.461 |
| 3 | 5 / 5 | 1.072 / 1.216 / 1.409 |

启动到controller版本校验：23.625ms（不是Connected）。测量请求包含curl进程启动的外层最大耗时11.936ms；超过1.2秒为0/15。
**这不检验真实VPN的1.2秒假设**：没有备用节点、慢握手或内核分段hook，误切比例/备用收益均无法判断。不输出p99或性能优胜结论。

负向控制没有丢弃：

- `/failure`返回HTTP503：curl可返回exit0，但sample.status=FAIL；没有计入成功率。
- `/slow`专用无副作用GET在100ms到期：curl exit28，sample.status=FAIL、timeout=true。
- 两项与测量样本分开标注，不把故意错误混入普通网络失败率，也不把它们伪装成功。

资源/清理快照：Core RSS 37,604 KiB、HWM 38,676 KiB、7 threads、12 FD；Core user/system各2 ticks。
同一观测窗口workload cgroup CPU使用增量333,641µs；这包含client/server及Orb其他任务，不是Core CPU归因。
throttled_usec无增长，guest steal 173→173 ticks；不能据此排除所有同宿主争用。
Core退出0，3个监听端口均关闭；主namespace路由/接口/DNS摘要前后相同。

## Profiling 的证据边界

`profiles-01`为debug级别独立诊断实例，未混入上述时间数据。对heap/goroutine/mutex/block/profile文件分别执行：

```sh
/tmp/tono-stage-a-20260913/go/bin/go tool pprof -top /tmp/tono-stage-a-20260913/profiles-01/heap.pprof
```

5次解析均exit0。heap采样in-use约3,097.59KiB；goroutine snapshot 9个。
CPU采样窗口1秒，实例空闲，0 samples；mutex/block均0且源码未启用采样。
**只能证明pprof采集/解析通路，不能声称没有锁竞争、GC成本低或CPU性能优秀。**

## 已运行但失败 / 已恢复的实验问题

1. **未恢复环境限制**：netem add exit2；内核`CONFIG_NET_SCH_NETEM`未启用，无模块目录。停止损伤网络实验，没有改宿主保护。
2. build-01失败：实验复制module根目录只读；修复实验入口权限后build-02成功。没有拿stock/latest顶替。
3. preflight-01的TUN探针误以为首包必是测试IPv4包；接口启动会发IPv6邻居发现。改为有界过滤后preflight-02三次双向校验通过。这是harness缺陷，不是Tono缺陷。
4. 清理开发探针发现杀sudo wrapper不足以立即杀root子树；最终入口补root watchdog，并有真实namespace超时回归。该问题已在交付工具中修复。
5. 交付自检发现空消息异常可写FAIL却返回exit0；窄测试先得到`0 != 1`，再修为按结构化status判失败。该harness问题已修；此前smoke-01/smoke-final均保存完整18条记录、所有正向正文校验通过，未经过该异常分支。

## 未执行 / 原生待验

未执行：sing-box编译/比较、Mihomo真实TUN吞吐、Reality/Hy2合成服务握手、公网TCP/UDP、受控损伤、混合出站、mux、长soak、内核reload/崩溃生命周期对比、race-detector轮次。
TUN能力探针是真TUN I/O，但**不是**Mihomo gVisor数据面性能试验。没有为阶段A伪造B/C配置或移植Tono Linux权限路径。

Mac/Windows必须验证：A2-01最终收紧故障、A2-02锁碰撞/取消延迟、PF/WFP真实过滤、DNS恢复、TCP↔Hy2切换、Core崩溃/重载/更新保护交接、原生UI阶段与真实采集存储。G1/G2/G3均未关闭。

## 原始证据位置与摘要

仓库外根目录：`/tmp/tono-stage-a-20260913/`。大型源码、编译缓存、二进制、pcap和profile都不进Git。
小型基线JSON/CSV保留在本报告目录的`raw/`，供补丁跨工作树转移；它们仅包含合成请求与环境读数。
Git内CSV仅将CRLF统一为LF，逐字段与原始文件一致；下表摘要仍指向仓库外未经转换的原始文件。`raw/samples.json`、`raw/capabilities.json`分别是原始JSON的samples/capabilities数组导出。

| 相对外部根目录的文件 | SHA-256 |
|---|---|
| `build-02/manifest.json` | `6ed02e74aaabe799912710f2eb220a02e8b206f491a2c10d2c9eebeed05a37f9` |
| `preflight-02/results.json` | `588c3afb0c360996d1bf124b01689459235805fd66293e1afabd4598bae2f1b5` |
| `smoke-01/results.json` | `f25f0f83684ad9e76f21b34cc5e2fc6fac495afc66ebf71616afccbb7fc1a05a` |
| `smoke-01/samples.csv` | `d21e2377ee8db4a1c27df1e6c06d04d0e1a2ee31a7c5f5b36ada5e2d75ce25c0` |
| `profiles-01/results.json` | `d71fc5532dcd6ef8c1ca05395b1d8fff8b5fd27a2e335fe5e3168dcd52a2eb6b` |
| `portable-connection.log` | `36aae668f759a0a46d7f94c68df7c7c6740a466625b6edfd6533ba574fedc99d` |
| `portable-node.log` | `c3ad4a70e3fc8963085b09776ccf868ce2a5d56ded7d207d7b6589030e6cff56` |

## 是否值得阶段 B

有条件值得做有限的合同/功能对照：已有可信patched baseline、隔离能力和失败不算成功的工具。
但当前证据**不足以升级或声称更快**。阶段B先解决真实reload/安全配置适配、固定同commit的B/C可构建性和合法合成协议服务；受控损伤必须另有支持netem的获准环境或明确缩小范围。
本线程在阶段A结束后暂停；仅在用户明确回复“允许开始阶段 B”后继续。
