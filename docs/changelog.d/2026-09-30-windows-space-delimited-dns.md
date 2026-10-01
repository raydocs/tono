## 2026-09-30 · Windows restores space-delimited original DNS servers
- 归属：SHIP_PLAN §2 item 10; Windows service DNS restoration.
- 来源：origin/main `6ffdfa7e` → branch `hunt/sol-r3dns-space-lists`, this PR; not yet merged.
- 缺陷修复：WIN-DNS-SPACE-LIST (P2): documented mobile broadband server lists were passed to the compatibility apply as one internally spaced server, then rejected. Parse separate addresses at the restore boundary.
- 新增/优化：无; raw registry originals, DHCP/profile behavior and ownership/protection predicates unchanged.
- 工程与测试：one regression verifies separate restored IPv4/IPv6 server entries from space-delimited originals.
- 验证：Linux Rust 1.98.1: before, 0 passed/1 failed (`Some(["10.20.30.41 10.20.30.40"])` instead of two addresses); after, focused DNS facade suite 59 passed/0 failed. `git diff --check` passed. Native Windows CIM/netsh and real adapter behavior not runnable here.
- 候选/发布：仅源码，无新候选; no deployment/publication.
- 剩余限制：needs-hardware for mobile broadband/static DNS restoration; known BRICK-W7 effective-state proof limitations are not changed.
