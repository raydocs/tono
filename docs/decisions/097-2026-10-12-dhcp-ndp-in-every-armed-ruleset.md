## 2026-10-12 · Does the Mac PF kill switch pass DHCP and neighbor discovery without a tunnel?
- Status: provisional (the owner may overturn it; only the owner sets `owner` or `reversed`)
- Chosen: `tono-dhcp` and `tono-ndp` render in every ruleset `renderRules` produces, including the
  ones with no tunnel (connect bootstrap, preserve teardown on a network move, `reassertIfNeeded`,
  the helper's emergency block). The widened permit is exactly two pairs, text unchanged: DHCPv4
  from port 68 to the limited broadcast `255.255.255.255` port 67 out (stateful, if-bound) and
  port 67 to port 68 in (`no state`); and ICMPv6 types 133–137 (router/neighbor solicitation and
  advertisement, redirect) both ways, `no state` in the no-tunnel rulesets (Apple PF keys
  non-error ICMPv6 state without the type, so a state from an inbound router advertisement could
  admit an Echo Request; each direction has its own pass) and the existing
  `keep state (if-bound)` text in tunneled rulesets (pre-existing, out of scope). This follows
  Windows' `intent_floor` in kind, not in content: Windows has infrastructure exceptions in every
  armed mode including block-all, and its floor also permits bounded DHCPv4 unicast renewal and
  DHCPv6 (`apps/windows/service/src/core/wfp_model.rs` 250–303, 348–364). The Mac change is
  narrower than that floor. mDNS, IGMP and Continuity stay tunnel-only and are not gated by
  "Allow local network devices"; `tono-lan`, link-local, multicast and SSDP stay tunnel-only and
  are gated by it. In tunneled rulesets the DHCP and NDP passes come after the physical-interface
  DNS blocks. Rejected: leaving them tunnel-only and
  fixing the lease some other way (the Mac is in the no-tunnel ruleset exactly while it reconnects
  after a Wi-Fi switch, so no other path exists before the lease), and adding unicast DHCP renewal
  or DHCPv6 now (not needed for a first lease on a new network; a later decision may add them
  toward the Windows floor).
- Why stricter: it widens availability, not exposure. The outbound permit names the limited
  broadcast only, so port 68 cannot reach a public host. The inbound permit is `no state`, so it
  creates no return path for port 68 to answer an arbitrary host; a reply is a one-shot datagram
  to port 68 from a server on the link. Neither carries payload to or from the internet: the
  broadcast never leaves the local link, and NDP is link-local by definition. The tunnel and
  control-plane rules, the DNS blocks and the final `block drop out quick all` are unchanged, so
  nothing the kill switch blocks for a leak becomes reachable. A hostile process on the same link
  could already send DHCP and NDP in the tunnel state this permit copies. The cost of leaving it
  out is a Mac that cannot get online until Tono is uninstalled. The owner may overturn this.
  DNS: the permit has no port 53/853 pass, and the helper self-test asserts that for the no-tunnel
  ruleset. A DNS query on a physical interface is dropped by the final block, as before (the
  `tono-lan-dns` block exists only with a tunnel, and still does there). A lease obtained through
  the new pass cannot change the resolver the Mac uses while protected DNS is pinned: the helper
  writes `127.0.0.1` into the network service's Setup DNS `ServerAddresses`
  (`ProtectedDNSManager.scSetDNS`, `tooling/scripts/core-helper/ProtectedDNSManager.swift` lines
  1079–1105, the assignment at 1099, commit and apply at 1102–1103), and an explicit Setup list
  takes precedence over DHCP-supplied servers (configd behavior, not verified on a device). The pin is written after the tunnel is up
  (`AppState+Connect.swift` 446) and a preserve teardown on a network move does not restore it
  (`restoreDNS` runs only when `releaseKillSwitch`, lines 1187–1203), so it holds through the
  reconnect window. In a fresh connect's bootstrap window it is not yet written; there the lease's
  DNS could be what the system picks, and only PF (no 53/853 pass) keeps a query off the wire.
- Applied in: PR #1591 (`claude/wifi-switch-mac-pf-dhcp`), helper 4.52.53.
