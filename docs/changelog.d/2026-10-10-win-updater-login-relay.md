## 2026-10-10 · Windows 更新器复用登录走通的中继
- 归属：ops 计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)，Amp 待办 [A1](../ops/amp-backlog-2026-10-10.md)（中继这条线，接 #1462–#1467）；
  Windows 客户端 `apps/windows/app/src-tauri/src/tono/commands/update.rs`、`tono/transport.rs`。
- 来源：基线 4e373f06（main）→ 分支 `amp/a1-updater-relay`；PR 待开；未合 main。
- 缺陷修复：[WIN-AUTH-CN-CF-PATH](../findings.d/WIN-AUTH-CN-CF-PATH.md) 的更新器一侧。原：更新器的中继偏好是自己的
  进程内静态量，与登录传输各记各的；登录已经只靠中继走通的设备，每次检查更新仍先走直连，黑洞网络上先等 Windows
  TCP 连接超时（约 21 s）才轮到中继。改后：更新器的 GET（发现文档、签名、安装包）与登录传输共用
  `TonoTransport::preferred_relay`：有偏好时第一跳就是那台中继；中继确证未送达失败时清除偏好（与登录相同），再走
  直连，再按序走其余中继；更新器经中继成功也会写回同一偏好。主机名、SNI、默认证书校验、`https_only`、无代理、
  无重定向不变；安装包的签名（Service 校验 minisign）与大小校验不变；中继不进 WFP 放行表（armed 时中继被拦，
  失败后清偏好走直连，fail-closed 不变）。`tono_check_update` 多一个 Tauri `State` 参数，前端 `invoke` 参数不变。
- 新增/优化：无。
- 工程与测试：新增 `#[test]` `a_relay_that_carried_the_sign_in_is_the_first_hop_of_an_update_get`（直连能应答，
  偏好指向第二台中继，GET 必须由中继应答）；`an_undelivered_discovery_get_falls_back_to_a_relay` 不变。
- 验证：Linux orb 上把 `get_with_relays` 与两条测试抽到临时 crate（真实 reqwest 0.13.5、tokio）离线跑：新代码 2 passed；
  基线代码新测试失败 `left: "direct" right: "relay"`。完整 src-tauri crate 只在 hosted `windows / app-rust`（ci-gate）编译与运行：待记。
- 候选/发布：仅源码，无新候选。
- 剩余限制：偏好仍只在进程内存；本进程登录/恢复尚未走过中继时，更新检查仍先付直连的连接超时再走中继；
  更新检查在读取偏好时短暂获取 `TonoState` 锁。移动线路实机验证未做。
