## 2026-10-06 · 整份替换目录时做客户端准入检查（#1273）
- 归属：SHIP_PLAN §2 item 10（新设备连不上且无下一手）；控制面。
- 来源：`ba639f6a` → 本 PR head，`claude/catalog-put-admission-20261006`；未合 main、未部署。
- 缺陷修复：C3-PC-F2。共享后台 `PUT exit-catalog` 只检查名称与身份占位，一条缺 Reality 字段（或 `network`/`flow` 不对）的 VLESS、
  或缺 `server`/`port`/`sni` 的 hy2 会被发布；Windows/macOS 遇到一条不收的条目就拒收整份目录，新登录和新设备拿不到目录。
  现在发布前逐条跑重新上架已在用的 `catalogEntryMissingClientFields`，不通过返回 400 `INVALID_CATALOG`，写明条目名与缺的字段，目录不变。
- 新增/优化：无。客户端、迁移、发布工具未改；已发布的目录不受影响，只拦下一次不完整的发布。
- 工程与测试：一条回归（`refuses to publish a catalog holding an entry clients cannot admit`）在旧源码上实跑 `expected 200 to be 400`，改后通过。
  24 个既有测试（25 例）用的最小 VLESS 夹具补上 `tls`/`servername`/`reality-opts`，断言未改。
- 验证：MacBook，`services/control-plane` `npm test`：`Test Files 44 passed (44) / Tests 1002 passed (1002)`；`npm run typecheck` 退出 0
  （`unchecked indexed access errors 520 (baseline 521)`、`76 (baseline 99)`）。exact-head ci-gate 见 PR。
- 候选/发布：仅源码，无部署。
- 剩余限制：检查读的是与重新上架相同的字段，不验证 `server` 是否公网 IPv4（客户端会验）；生产现行目录未经本检查重读，
  若其中已有不完整条目，下一次发布会被拒并指出条目。
- 续记 2026-10-06（评审修复轮）：jev-route `dbc3bc74`（Opus 5.5 + Codex gpt-6.1-sol，互验）PASSED，4 条 minor。本轮修掉：
  VLESS 条目同样要求 `server`、`port`、显式 `type`；端口必须是裸整数 1–65535（带引号或前导零的端口 Windows 读不成数字，会拒收整份）；
  名称不超过 128 字节。同一条回归加一个带引号端口的条目，旧源码上实跑 `expected … to contain 'Tono-Quoted: port'`，改后通过；
  `npm test` 全量 `Test Files 44 passed (44) / Tests 1002 passed (1002)`。运维只读页（`ops/reads/fleet.ts`）用同一函数，会同步多报这几项。
  仍开着（记为限制，不再修）：字段按键名在整个条目里匹配，不分 YAML 父级（嵌套的同名键可能误拒，缩进错位的 Reality 字段可能误收）；
  不校验 server 是否公网 IPv4、SNI 主机格式、hy2 指纹格式与节点数上限。`port: +443` 两端客户端都收而这里拒收，属更严，保留。
  生产现行目录是否满足新检查未验证（目录密文存储，本会话没有运维令牌）；不满足时下一次发布会得到点名条目的 400，不会发出坏目录。
