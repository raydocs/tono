## 2026-10-01 · macOS helper：升级不堵、DNS/PF 收口
- 归属：SHIP_PLAN §2 item 10。macOS root helper。needs-hardware：LAN DNS 范围重载、PF token、升级复制和 DNS 状态都要在实机上看。
- 来源：基线 `8ee3d098`（#889 已在 main，协议 4.52.10）→ 4.52.11。分支 `cursor/helper-open-issues-6122`，[#979](https://github.com/raydocs/tono/pull/979)。
- 缺陷修复：#928 静默升级从非阻塞 fd 复制，复制期间不持更新锁，SIGTERM 会中止复制和提交前的等锁。#897 每次 SIGTERM/SIGKILL 前重核路径和 uid。#896 更新下限是签名校验前后两次相同的有界读取。#895 `pfctl -X` 非 0 且 token 仍在列表里时保留记录。#894 新出现的 en* 只重载锚点、不 flush states，失败不释放。#893 受保护 DNS 状态按 serviceID 读。
- 新增/优化：无。
- 工程与测试：#860 给 `readRequest` 加了管道上的有界解码自测。其余每条行为一个 `--self-test`。本机没有 Swift，没有执行。
- 验证：未在本机执行 helper `--self-test`。托管 macOS CI 跑 `build-core-helper.sh`。
- 候选/发布：无新包。
- 剩余限制：没有实机 pfctl / FIFO / 网卡热插拔。升级 `--version` 探测仍可能卡住。公司 VPN 的 DNS 仍不进 LAN DNS 阻断。
