## 2026-10-02 · Windows：替换 sing-box 进程后，应用缓存的旧 fake-IP 不再指向别的网站
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) §2 第 10 项。Windows App（sing-box 配置编译）、`tono-core`、sing-box 模板。
- 来源：[#1258](https://github.com/raydocs/tono/issues/1258)，分支 `fix/win-fakeip-rotate`，[#1333](https://github.com/raydocs/tono/pull/1333)。未合 main。
- 缺陷修复：sing-box 的 fake-IP 表只在进程内存里，地址从段的开头按顺序分配（alpha.9 `dns/transport/fakeip/store.go`）。Windows 上可选 DIRECT 是在 Connected 之后替换 sing-box 进程来生效的，新进程从同一段的开头重新分配，应用还缓存着的旧地址就对应到新进程最先解析的另一个域名：浏览器拿着原域名的 SNI 连到别的站点，出现证书错误（HSTS 站点是不可跳过的错误页），持续到 DNS 缓存过期（系统 30 秒，浏览器更久）。每次带 DIRECT 策略的 Connect 都会替换一次进程，替换回完整隧道时再替换一次；是否真的出现证书错误取决于缓存里还有没有旧地址、新进程先解析哪些域名。现在 fake-IP 池是 `198.18.128.0/17`，分成八个 /20 槽位，每份编译出的文档取下一个槽位；模板里新增一条规则拒绝目的地址落在池内（以及旧池 `198.18.16.0/20`）的纯 IP 连接。旧地址在新进程里不属于它的槽位，被拒绝，不再连到别的站点；应用重新解析后恢复。槽位计数（下一份文档的位置）写在 Tono 数据目录的 `fake-ip-slot`，App 重启后接着数。
  - 评审第一轮后的改动（Codex，记录在 PR 评论）：第一版把原来的 /20 切成四个 /22，每个进程的地址数从 4093 降到 1021，回绕更早，而回绕会把还在缓存里的地址交给另一个域名；现在每个槽位仍是 /20。计数原来只在内存里，起点取自启动时间，重启的 App 有四分之一概率与正在运行的进程同段；现在落盘。拒绝规则加 `no_drop`：sing-box 默认在 30 秒内拒绝超过 50 次后改成丢包，大量连接同时重试时旧地址会变成超时。
  - 评审第二轮后的改动：计数文件读得到但存不回去时，第一版每次启动都读到同一个数、取同一个槽位；现在第一次取槽位时存不回去就改用时钟。计数器从全局静态变量挪到 App 状态上，文件路径用状态里的 Tono 数据目录：原来的写法在测试里会碰 Tauri 句柄（`the_service_admits_what_both_compilers_emit_for_direct` 在 `13746af2` 上因此 panic，hosted CI 失败），也会让单元测试推进真实目录里的计数。读计数最多读 32 字节。
- 新增/优化：无。
- 工程与测试：`tono-core` 一条回归（相邻两份文档的 fake-IP 段不相交、都是 /20、都在 DNS 证明接受的 198.18/16 内，且池的拒绝规则排在 home/DIRECT/出口规则之前）；App 两条回归（重启后的 App 从文件里的计数接着取槽位；存不回去的计数不用）；`RuntimeInput` 新增必填的 `fake_ip_slot`；`/rules` 证明的字段清单加 `no_drop`（sing-box 不把它印进规则字符串）；两处按下标断言的既有测试随规则位置和段的变化同步。Service 的文档准入和 `/rules` 证明不需要改：准入不限定 fake-IP 段，`/rules` 的期望字符串由同一份文档生成。
- 验证：见 PR。本机没有连接、没有原生构建；`tono-core` 和 App 的测试由 hosted CI 运行。hosted 的 alpha.9 `check` 只检查冻结的参考文档和 macOS、hy2 fixture，不检查 Windows 模板或 Windows 编译出的文档；同一条拒绝规则（两个 CIDR、`no_drop`）由 [#1334](https://github.com/raydocs/tono/pull/1334) 的 macOS fixture 和 macOS 编译结果过 pinned 解析器。
- 候选/发布：仅源码，无新候选。
- 剩余限制：没有实机验证（`needs-hardware`）。用旧地址的连接被拒绝，应用什么时候重新解析取决于它自己的缓存（fake-IP 应答的 TTL 是 30 秒）。槽位在八份文档后复用：同一段缓存时间内编译了八份文档（DIRECT 替换一次用两份）才会回到原槽位。失败、取消或没有启动的编译也消耗计数。计数文件读不到、或第一次取槽位时存不回去，起点取自时钟（可能与正在运行的进程同槽）；运行中途才开始存不回去时，下次启动读到的是较早的计数。写计数不是原子写，掉电后可能回退。读写在取槽位的锁里同步进行。Service 自己用同一份文档重启进程的路径（看门狗重启、期望状态恢复、替换失败后的还原和重试）没有修，另记 WIN-SINGBOX-FAKEIP-SERVICE-RESTART。从旧版本升级时，旧进程发出的 `198.18.16.0/20` 地址由同一条规则拒绝。macOS 的 `/core/sync` 重启有同样的问题，见 [#1334](https://github.com/raydocs/tono/pull/1334)。[决策 047](../decisions/047-2026-10-02-windows-fakeip-rotation.md)。

### 2026-10-02 续记：已合 main
- 来源合入：#1333，merge commit `212dbd6b`，PR 头 `2ef9f917`。该头的 `ci-gate` 全绿：https://github.com/raydocs/tono/actions/runs/37017275168 。
- 独立评审（Codex `gpt-6.1-sol`，high）：各轮范围、发现和处置记录在 https://github.com/raydocs/tono/pull/1333#issuecomment-5954529114 ；最后一轮没有未处理的 major。
- 候选/发布：仅源码合入 main。无新安装包，无部署，无客户发布。没有实机验证。
