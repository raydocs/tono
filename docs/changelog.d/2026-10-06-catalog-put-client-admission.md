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
