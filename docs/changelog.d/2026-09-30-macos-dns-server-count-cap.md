## 2026-09-30 · macOS：受保护 DNS 服务器数量上限统一为一个常量（32），读得回的列表恢复得回
- 归属：SHIP_PLAN G2（macOS 连接与恢复）缺陷修复（冻结期归类由所有者认定）；影响 helper
  `tooling/scripts/core-helper/ProtectedDNSManager.swift`。发现 MAC-DNS-SNAPSHOT-OVER-8。
- 来源：main `01c2403f` → 分支 `glm/mac-helper-dns-cap`；PR [#765](https://github.com/raydocs/tono/pull/765)；未合 main。
- 缺陷修复：
  - MAC-DNS-SNAPSHOT-OVER-8：`enable` 经 SC 路径读当前 DNS（`scCurrentDNS`→`dnsServers`，无数量上限），
    `save` 不查数量，但 `loadSnapshot`、`writeDNS`/`setDNS`、`parseDNSOutput` 都只收 8 条。于是 >8 台解析源
    （企业/VPN、IPv4+IPv6 列表）的服务 enable 成功、快照落盘，断开时 `loadSnapshot` 判快照无效，`restore` 走
    损坏快照路径隔离并以无快照清扫收尾：原始静态解析源永不恢复，服务被重置为自动/DHCP（纯静态 DNS 环境即失去
    解析）；enable 提交失败时回滚 `writeDNS(snapshot.servers)` 同样只收 8 条而被跳过，服务可能留在 127.0.0.1。
    改为共享常量 `maximumDNSServerCount = 32` 统一约束 networksetup 读回解析（`parseDNSOutput`）、存（`save`）、载（`loadSnapshot`，校验抽为 `isRestorableSnapshot`）与写
    （`writeDNS`/`setDNS`）；`enable` 在 `save` 之前显式拒绝超限列表，任何系统改动前就失败；SC 读路径
    （`scCurrentDNS`）刻意不设上限，以免 `verifyRestored` 与恢复清扫因某个外来长列表被拒而阻断恢复（审阅时改）。32 台 45 字节 IPv6
    加名称字段约 2 KB，远小于 `maximumStateBytes` 16 KB；`networksetup -setdnsservers` 与 SCPreferences 的
    DNS 数组均无 8 条限制（8 为自设界）。旧 helper 已落盘的 9–32 条快照（旧 save 无上限，可写出）随上限放宽
    重新可载可恢复；此前已被隔离改名的文件不自动收回。
- 新增/优化：无。
- 工程与测试：helper 自测新增 `runServerCountCapSelfTest()`（挂入 `runSelfTests()`，随 `--self-test` 执行）：
  9 台服务器列表经 `parseDNSOutput` 读取、`writeDNS` 守卫（注入 writeByID）写入、`JSONEncoder`/`JSONDecoder`
  往返后通过 `isRestorableSnapshot` 载入校验；并断言 33 台在读取、写入与载入校验处全部拒绝。`loadSnapshot` 的
  内容校验抽为同一静态谓词供生产与自测共用，语义未变（仅数量上限 8 → 32）。
- 验证：本工作区无 Swift/Xcode 工具链，未本机编译或运行（按 [docs/BUILD_AND_TEST.md](../BUILD_AND_TEST.md)
  helper 自测由托管 CI 执行）；未实机验证 >8 台真实服务的 enable/restore；helper 版本按规则升 0.0.1 至 4.52.7 并重算
  `CONTRACT.sha256`（与同日 helper PR 撞号，后合者需再升一档）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：>32 台解析源的服务 enable 仍被拒绝（发生在任何系统改动之前，不碰网络）；networksetup 回退读超过 32 台仍报不可读（原本限 8）；
  32 上限对真实 networksetup/SCPreferences 的接受度为推导，未实机执行；修复前已被隔离的快照文件不会自动恢复。
