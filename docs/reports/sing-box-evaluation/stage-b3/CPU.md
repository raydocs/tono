# CPU：计数差异复现，但长 SSE 的主要差额尚未归因

**B3 复现了 `/proc` 进程CPU计数中的 gVisor 优势；CPU profile 尚不能解释大部分 SSE 差额。**
不能把几个采样函数包装为已确认根因，更不能直接推导原生省电或迁移收益。
正常轮次与下面诊断轮次严格分开；正常数值见 [RESULTS.md](RESULTS.md)。

## 9 个独立诊断窗口实际完成，3 个 idle profile 没有样本

`profile-01`：9/9场景PASS，3/3长SSE完整，三个固定B2 burst prelude均成功；总wall 290.449s。
每窗口新进程、同一固定二进制，CPU capture32s，400ms后启动工作负载。
所有profile文件都能被同版Go `tool pprof`解码，6个负载profile有带函数名的样本；没有重建内核。
Mihomo启用debug日志才能开放其profile路由；sing-box启用隔离loopback debug listener。
这些是诊断配置差异，不用诊断结果替换正常数据。

| 候选 | idle进程CPU ms / profile样本ms | SSE进程CPU ms / profile样本ms | burst进程CPU ms / profile样本ms |
|---|---:|---:|---:|
| A Tono Mihomo | 20 / 0 | 1070 / 120 | 400 / 320 |
| B sing-box gVisor | 10 / 0 | 260 / 90 | 310 / 230 |
| C sing-box Go | 30 / 0 | 1070 / 90 | 120 / 110 |

进程CPU是`/proc/<pid>/stat` utime+stime之和，窗口包围工作负载；SSE约30.066s。
profile窗口32s包含整个负载，但样本加权CPU与进程CPU**没有闭合**：SSE仅约11%/35%/8%。
这不是统计置信区间，也不是可以拿来补齐CPU的系数。profile有采样误差、调度/计费边界等可能，
**具体原因未定位**。本次没有分别保存utime/stime，也没有逐线程CPU或内核级采样，
因此不能把未解释部分一律归为kernel CPU、定时器、忙轮询或锁竞争。
3个idle profile均0样本，故没有可报告的idle热点；不能声称无后台CPU。

burst工作负载只有约0.524/0.440/0.372s，余下profile窗口基本idle。
这一独立诊断中C的CPU仍更低，但每候选只有一次、存在debug差异及小样本，
不另做正式burst排名，也不和B2三个正常轮次混算。

## 实际采到的函数；累计时间不可相加

原始flat/cumulative文本在 [raw/cpu-top](raw/cpu-top)，二进制profile路径及SHA-256在
[profile-01.json](raw/profile-01.json)。下面数值仅属于已采样部分。

| SSE候选 | 直接采样证据 | 允许的解释 |
|---|---|---|
| A | `internal/runtime/syscall/linux.Syscall6` flat70ms；`gonet.(*TCPConn).Write` cum40ms；`NonBlockingWriteIovec` cum30ms | 样本包含系统调用和gVisor发送路径，不能解释未采到的约950ms |
| B | `Syscall6` flat50ms；`runtime.netpoll` cum50ms；`copyExtendedWithPool` cum20ms | 样本涉及网络轮询/复制；总共90ms，不足以把各个10ms样本排成精确热点榜 |
| C | `Syscall6` flat30ms；`GoConn.WriteBuffer` cum40ms；`GoConn.transmitFrame` cum30ms；`goEngine.run` cum30ms；`goWheel.advance` flat10ms | 样本证实发送/engine/timer路径在执行，**没有证明timer或发送路径是CPU差额的根因** |

父子调用累计值重叠；例如`WriteBuffer→transmitFrame→Syscall6`不能相加。
Go的一个10ms采样就占该SSE profile的11.1%，百分比看似显著但只有极少样本。

burst样本中，A有`memclrNoHeapPointers`30ms、`memmove`20ms、gVisor buffer/发送调用链；
B有gVisor packet处理、内存清零/分配和crypto调用；C主要是`Syscall6`50ms、
`futex`20ms、`scanblock`20ms及crypto10ms。C burst共110ms，两个GC相关样本
**不足以证明GC解释了“burst快、SSE CPU高”**。

## 没有开启的采样，不报告为零

- 未增加allocation/GC profile：当前优先缺口是SSE的进程CPU与CPU采样总量不闭合，
  且SSE profile没有呈现足够强的GC热点。RSS增长不能直接当成GC CPU或泄漏证据。
- 未启用mutex/block采样。`futex`、原子操作或某个mutex函数出现在CPU profile，
  不等于已测到等待时间；**不能得出“无锁竞争”或“锁是根因”**。
- 未运行race detector、perf/eBPF或新增诊断内核构建；不再把额外负载混进正常统计。

## 下一次若继续，应先补计数闭合，不急着改栈

用同一固定内核、相同30s SSE，单独记录每进程/线程的utime和stime、独立进程rusage，
校准CPU采样时钟/覆盖率；必要且环境允许时才增加内核级采样。
只有确认差额归属后，才针对对应路径做单变量实验（如不同事件间隔），不能从当前profile
直接改定时器、加全局锁或迁移内核。上述工作**未执行**，需要独立批次，旧结果保持不变。

当前结论：CPU计数差异在两批里重复；主要机制仍未定位。没有足够证据解释全部收益来源，
更没有足够证据声称可以直接替换Tono正式内核。
