## 2026-10-01 · Windows mihomo DoH backup no longer needs a GeoIP database
- 归属：SHIP_PLAN §2 item 10; Windows mihomo runtime (explicit mihomo choice, or the pre-arm fallback when sing-box is missing).
- 来源：main `0676435b` → branch `hunt/claude-r4ipc-mihomo-fallback-filter`; #1221; not yet merged.
- 缺陷修复：`WIN-MIHOMO-FALLBACK-MMDB` (P1, regression from #1121). Adding `dns.fallback` turned on mihomo's default fallback filter (GeoIP CN). Mihomo then has to load `Country.mmdb` while it parses the config. Windows does not ship that file, so the Core tries to download it before the tunnel exists and refuses the config when the download fails. The App now writes `fallback-filter: {geoip: false}`, and the Service refuses a `fallback` without it. The backup DoH server is again asked only when the primary answer is empty or an error. Before this fix the default filter also sent every non-CN answer to the backup.
- 新增/优化：无。sing-box path unchanged; the primary/backup servers, lazy query and exit pinning are unchanged.
- 工程与测试：the existing `tono-core` DNS test now checks `fallback-filter.geoip == false`. The existing Service test `the_service_refuses_a_plaintext_dns_fallback` now also refuses a fallback without the filter.
- 验证：local mihomo `v1.19.30-tono-gvisor-adaptive.1` (`-t` config test only, unreachable `geox-url`): the #1121 DNS block fails with `load GeoIP dns fallback filter error, can't download MMDB`; with `fallback-filter.geoip: false` the same document passes. `rustfmt --check` shows no new diffs. `cargo test` not run locally; hosted Windows CI runs it.
- 候选/发布：仅源码，无新候选。
- 剩余限制：needs-hardware. A real Windows mihomo connect with the sing-box binary removed has not been run.
