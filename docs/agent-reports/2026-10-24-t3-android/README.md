# T3 Android · 2026-10-24

基线：fetch 后 `origin/main=322f48c6fcb13b26279fed22ae19f79dcc2522bb`，干净 `fix/t3-android`。
归属：SHIP_PLAN G1/G2 缺陷修复；仅源码，不推进客户发布门。未动其他 checkout、settings PR、服务器、feed、迁移、签名或部署脚本。

## 范围与意图表

| 事件 | 应有状态/意图 | 通知 | 本 PR |
|---|---|---|---|
| 用户断开/取消 | 隧道先停；IDLE/SIGNED_OUT；wantConnected=false；旧回调不能写失败 | 不发 stopped；存储失败用中英文 Toast 告知重启可能重连 | 修复存储顺序、当前实例停止意图和已排队 core 回调 |
| 系统撤权 | 隧道停；NEEDS_PERMISSION；清恢复意图 | revoked；lockdown 不承诺网络放开 | 仅修复存储失败不得阻断状态/通知；系统设置引导未完成 |
| 可恢复失败 | FAILED，自动恢复保留意图、手动尝试按既有定义 | 自动尝试应 stopped + 重试；lockdown 应说明仍受系统拦截 | 现有 fail 路径不变；全部失败出口覆盖仍未完成 |
| 重新探测 | 保持 CONNECTED/DEGRADED 和同代 applied；probe=CHECKING | 不把工作隧道说成新连接 | 已修复，旧地理位置清空；Compose 补测未执行 |
| DNS 取消 | 即刻释放同步等待，取消查询，不再调用已取消 ctx | 不产生连接失败 | 原子 single-completion；保持原 12s 正常查询预算 |

停止持久化失败不伪装成功写盘：先关闭 TUN，再尝试保存，失败明确告警。
同一服务实例阻止自动请求覆盖已停止意图；**进程重启后若磁盘旧值仍为 true，仍可能恢复**，Toast 明说并指向系统 Always-on 设置。
Core 回调在入队时捕获 attempt，处理时检验代次和活动 phase；只保证已排队旧回调的隔离，不声称 libbox 在未来才生成的无来源回调已获得完整来源标记。

## 实际 RED / GREEN（MacBook，JDK17 + Kotlin2.3.20 + JUnit4.13.2）

| 行为 | RED commit / 原始结果 | GREEN |
|---|---|---|
| 断开存储异常 | `310651e71`：`IOException: disk full` | `dbc7dcbc5`；停止事件先于保存/告警 |
| DNS 取消 | 同上：`cancellation must not wait for the 12 second DNS timeout` | `dbc7dcbc5`；零等待 latch 检验、取消后的迟到完成被拒绝 |
| 重查不降级 | 同上：`expected:<CONNECTED> but was:<CONNECTING>` | `dbc7dcbc5`；CONNECTED/DEGRADED、attempt/applied 保留 |
| 已排队 core stop | `ceb8f6862`：`closing our own core is not a failure` | `cde9a1ebc`；受控队列，无 sleep，后继连接不被旧回调停止 |

前三项 [RED](red-lifecycle.log)：compile exit 0；51 tests / 3 failures。
第四项 [RED](red-core-stop.log)：compile exit 0；57 tests / 1 failure。
最终源码 `cde9a1ebc` [GREEN](green.log)：compile exit 0；**57 tests, 0 failures**。
包含 TunnelAuthority、StopPersistence、DnsCompletion、现有 PropagationWait 六测及 SurfaceRules/StatusFile/ClaimRules；不包括 Android service、BoxPlatform 或 Compose 编译。
原先 `recheckingWithdrawsConnectedUntilTheNewExitResultsArrive` 明确要求错误的 CONNECTING 行为，已由意图规则回归替代；不是放宽断言，旧代码确实触发新增断言 RED。独立的 probe 清理测试保留。

复跑：`JAVA_HOME=<JDK17> ANDROID_HOME=<existing-sdk> python3 docs/agent-reports/2026-10-24-t3-android/run-jvm.py --gradle-lib <existing-gradle-9.5.1/lib> --junit-dir <junit-4.13.2-and-hamcrest-core-1.3-directory> --output <new-evidence-dir>`。
此辅助脚本源于现有 `apps/android/scripts/run-state-jvm-tests.py`，使用现有 compiler/SDK jars；仅生成真实 ControlPlane 所需的 BuildConfig.DEBUG=true，不模拟 Android/libbox。
脚本记录编译命令、源码/依赖摘要与原始结果。运行原始目录：`/tmp/t3-red-310651e71`、`/tmp/t3-red-core-stop-distro`、`/tmp/t3-green-final-harness`。

## 传播等待 WIP：只读执行，不重写/不移植

复核发现 `74ee58ef5` 的实际实现已是 `CatalogPreparation.kt`，不是基线的 `PropagationWait.kt`。
从 git 对象提取该 WIP 的 `CatalogPreparation/ControlPlane/LocalTestServer/AccountWorkQueue` 与**同一份最终 CatalogPreparationTest**到 `/tmp`；未切换/修改其工作树。
生产源使用 staged RED `f537965b1` 时，编译成功，实际失败 `explicit catalog propagation must wait, not finish on the first 503`，见 [WIP RED](red-propagation-wip.log)。
生产源使用 `74ee58ef5` 时，编译成功，同一最终测试通过，连同当前纯测试 **58 tests, 0 failures**，见 [WIP GREEN](green-propagation-wip.log)。
该单测含真实 ControlPlane HTTP parser/socket seam、AccountWorkQueue 和受控时钟，覆盖 GET/POST 分类、deadline、取消、迟到结果；不是实际 Android IO/首登证据。
提取命令：`git show <ref>:apps/android/mobile/src/{main,test}/kotlin/com/raydocs/tono/mobile/engine/<file>.kt`。RED 只替换上述四个生产文件，不改最终测试；将这些文件加入相同 K2/JUnit harness。
WIP **没有进入本 PR**，仍需其独立集成、完整构建/UI 验证与审查，不能用本报告把它当 main 已修复。

## 未验证与跳过

- Gradle offline 首次因 AGP9.3.1 不在缓存而失败；联网重试成功解析插件，但到 `:mobile:verifyLibbox FAILED`：`Missing mobile/libs/libbox.aar`。见 [原始构建日志](gradle-blocked.log)。未修改 pin、未伪造 AAR、未本机编译 Core。
- Devin verify API 返回 `HTTP 403 Forbidden`，`billing error ... out_of_quota`，没有 session/run URL；API 调用在创建 VM 前失败。故 API29/30/34 **均未运行**。
- 新 Compose UI 回归未执行；完整 Android 编译/lint/所有 JVM 测试未执行；需 PR android-ci 的精确 SHA 结果，不把纯编译当 AGP 成功。
- `exchange()` 的 Android DNS callback 显式使用 `dnsExecutor`；libbox 调用 exchange 的 Go 线程/是否阻塞单一引擎线程尚无运行证据，故不声称已在设备观察 12 秒 engine freeze。
- 测速 protect：要求先做模拟器观察，云配额阻断，**不凭推导改 socket 行为**。
- 未完成其余大范围：全部自动失败 stopped/通知拒权/lockdown 设置引导，离线 Core 启动终止策略、catalog 持久化异常回调、前台 start/stop 竞态、ACTION_DISCONNECT 非前台 stopSelf、io/NetworkMonitor HandlerThread 释放、每秒通知重贴、旧401账户状态分类、IPv6恢复、AppsScreen/错误码/logout/preparing P2。
- `ANDROID-A140-NOTIFICATION-REPOST` 是旧系统重贴导致错误承诺的既有账本条目，与每秒重复 notify 不是同一根因；本 PR 不冒领它。
- 已复核 #1722/#1723 改动路径；不编辑其 settings/主 strings.xml。`316887d2a` 的 underlying reconciliation 未移植，集成方需检查共享 TonoVpnService hunk。
- 真机待验：Doze、重启、always-on/lockdown、真实撤权、通知权限允许/拒绝、满盘下断开及重启提示。没有新候选/安装包、没有签名或发布证据。
- 未独立审查；按编排约定交给 Claude 交叉审查，禁止合并/auto-merge。
