## 2026-10-10 · macOS 更新安装包下载经 Tono 中继回退
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)，Amp 待办 [A2](../ops/amp-backlog-2026-10-10.md) 续做
  （#1472 记下的限制）；macOS 客户端 `apps/macos/Tono/Services/{NativeUpdateDownload,ControlPlanePath}.swift`。
  服务端、helper、PF 不改，`HelperProtocolVersion` 不变。
- 来源：基线 origin/main a6ebf460 → 分支 `amp/a2b-mac-package-relay`；未合 main。
- 缺陷修复：[WIN-AUTH-CN-CF-PATH](../findings.d/WIN-AUTH-CN-CF-PATH.md) 的 mac 安装包侧。原行为：发现文档已能经中继，
  安装包（`NativePackageDownload`，URLSession 落盘）只走直连，Cloudflare 路径不通的客户看得到更新、下载失败。
  改后：直连在任何应答前失败（`task.response == nil`，与发现 GET 同一规则）时，同一 GET 依次走
  `ControlPlanePath.apiRelays` 中发布主机的两台中继（Westwood、Mesa :2053，每台 5 s 建连预算），TLS 用与固定 IP
  客户端同一组参数（`PinnedTLS`：SNI 为发布主机名，默认证书校验，无代理），一次请求、不跟随重定向。正文按收到的块
  直接写入 0700 目录下的 0600 文件，内存只留响应头与一块；只接受 200 且 `Content-Length` 等于签名清单里的大小、
  无 `Transfer-Encoding`；超出大小即失败；写满签名大小后等连接关闭（最多 2 s），其间多出一个字节也失败。预算同直连：
  60 s 无字节、整次 900 s。任何状态行（含 103 等 1xx）即表示中继已收到请求，不再换路；
  失败时删除整个临时目录。root helper 照旧复制并校验包哈希与 manifest 签名，未改。
- 新增/优化：TLS 参数提取为 `PinnedTLS.connection(to:host:)`，固定 IP、中继与握手自检三处共用（行为不变）；
  `ControlPlanePath.relayEndpoints(for:)` 供 API 客户端与安装包共用。中继不进入 PF 放行表，armed 时被拦截。
- 工程与测试：一个回归 `NativeUpdateDownloadTests.testDeadDirectPathStreamsThePackageFromTheRelayToDisk`（直连
  在应答前被拒，中继分 16 块送出 256 KiB 包；每块之后磁盘上的文件长度等于已送字节数，最终内容与权限一致；发布主机
  的生产中继顺序为 Westwood、Mesa；写满后多一字节被拒；第一台中继回 103 后断开时不再走第二台）。
  独立审查（协调方）PASS 带两个 MINOR，同一 PR 第一轮已修：1xx 状态行也算已应答（M1）；写满后等关闭、拒多余字节（M2）。
- 验证：本机不跑 xcodebuild；由 hosted macOS CI（ci-gate）在 PR 头 SHA 上运行。
- 候选：仅源码，无新候选。
- 剩余限制：中继回应若用 chunked 或不带 `Content-Length` 则视为无效应答（发布 Worker 总是按 R2 对象大小发
  `content-length`）；不记中继偏好，每次下载按序重试；实机（移动线路）未验证。
