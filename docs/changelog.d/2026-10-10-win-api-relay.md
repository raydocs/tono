## 2026-10-10 · Windows 登录经 Tono 自有中继绕过 Cloudflare 不可达路径
- 归属：SHIP_PLAN §2 item 10（「连不上且无下一手」例外，所有者 2026-09-29 批准，2026-10-10 指定 DMIT 节点）；
  Windows 客户端 `apps/windows/app/src-tauri/src/tono/{bootstrap,transport}.rs`、登录页支持信息；节点 Westwood nginx。
- 来源：基线 d4f5f881f（main）→ 分支 `fix/win-api-relay-20261010`；PR 待开；未合 main。
- 缺陷修复：[WIN-AUTH-CN-CF-PATH](../findings.d/WIN-AUTH-CN-CF-PATH.md)。原失败：中国移动线路上固定 IP 与系统 DNS
  都 `connect` 失败后，DoH / 备用端口仍落在 Cloudflare 同一路径，登录发码失败 `TONO_AUTH_TCP`。改后：两条直连
  路径都确证未送达失败时，先试编译进客户端的 Tono 中继（`API_RELAYS`，179.253.233.220:2053，4 s 连接预算），
  再 DoH、备用端口、隧道；中继应答后本进程后续请求优先走中继，确证未送达失败则清除。支持信息 Transport 行
  增加 `relay=<kind>`。
- 新增/优化：节点侧 nginx `stream` + `ssl_preread`，只放行 SNI `api.afk.ccwu.cc`，转发到 104.20.26.170:443
  （备 172.66.162.98:443）；不终止 TLS，节点无证书无明文。不加入 WFP bootstrap 放行表（armed 时中继不可用，
  不放宽 fail-closed）。决策 [077](../decisions/077-2026-10-10-api-relay-outside-cloudflare.md)。
- 工程与测试修正：`TonoTransport::with_clients_and_relays` 测试构造；一个回归
  `dead_cloudflare_paths_fall_back_to_a_relay`（POST，两条直连路径黑洞，中继应答且被记住、第二次请求不再付黑洞预算）；
  前端 `login-support.test.tsx` 现有用例补 relay 段。
- 验证：节点 2026-10-10 03:04 UTC `nginx -t` 通过、reload、`tono-xray` active；Mac 经中继
  `HTTP/2 200`（证书 `CN=afk.ccwu.cc`，GTS WE1），错误 SNI 0.09 s 内被关闭，明文 HTTP 被关闭；客户端形态请求
  （URL `:2053`、Host 带端口）GET 200、POST 400（Worker 应答）。ping.pe `tcp 179.253.233.220:2053` 国内全部探测点
  可达（移动 139–142 ms）。vitest `login-support.test.tsx` 2 passed（本机）。Rust 回归仅 hosted Windows CI 运行：待记。
- 候选：仅源码，无新候选；0.0.75 不含此修复，客户需先经外网更新到含此修复的版本。
- 未做：macOS 客户端中继回退（同一服务端，另开 PR）；中继第二节点；实机（移动线路）验证待用户更新后反馈。
