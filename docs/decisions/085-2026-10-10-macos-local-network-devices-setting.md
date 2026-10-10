## 2026-10-10 · macOS: which connected-state PF passes the "Allow local network devices" setting (default off) withholds
- Status: provisional (agent for backlog A29 under decision 079 D3-A, owner asleep; the owner may revisit)
- Chosen: one app setting, 「允许局域网设备」 / "Allow local network devices", default off, sent to the helper as the
  optional arm field `allowLocalNetworkDevices` (only when on; absent means off). Off withholds, while a tunnel is up,
  the passes `tono-lan` (out and in, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`), `tono-linklocal` (out and in,
  `fe80::/10`, `fc00::/7`, `ff00::/8`), `tono-multicast` (`224.0.0.0/24`, `255.255.255.255`) and `tono-ssdp`
  (`239.255.255.250` UDP 1900). Kept either way: `tono-mdns` (UDP 5353 to `224.0.0.251` / `ff02::fb` only),
  `tono-igmp` (protocol 2, the group membership mDNS needs on a snooping switch), `tono-continuity` (`awdl0`, `llw0`,
  `bridge100`: interface-scoped, decision 045 kept them for Universal Clipboard and Sidecar), `tono-dhcp` (broadcast
  only), `tono-ndp`, and every block rule, including the #348 LAN DNS block `tono-lan-dns`. On renders exactly the
  4.52.44 rules. The setting is ephemeral in the helper like `reviewedBundleDirect`: the persisted state never
  carries it, so a heal, boot restore or emergency state renders off until the app re-arms.
  Off also covers what the Core carries (review round 2): the sing-box document rejects `10/8`, `172.16/12`,
  `192.168/16`, `169.254/16`, `fe80::/10`, `fc00::/7` ahead of every DIRECT route (TUN, the loopback mixed proxy,
  reviewed-app and web-direct routes), and when the reviewed-bundle permit renders, PF drops root's traffic on its web
  ports to those IPv4 ranges plus `100.64/10`, `224/4` and broadcast first (`tono-bundle-local`). The Core reads the
  setting when its document is built; a document older than the current setting is either stricter (Core off, PF on)
  or held by PF (Core on, PF off), so a mismatch fails closed. A re-arm of the live session that fails after the PF
  load keeps the block and intent instead of releasing them.
  Rejected: (a) a separate explicit LAN DNS permit. The task text read "only LAN DNS (as tightened by #348) and mDNS
  are permitted", but #348 is a block, not a permit: after it, LAN DNS passed only through `tono-lan` on non-`en`
  interfaces (another VPN's utun). Keeping that would add a dedicated DNS permit whose only user is split DNS of a
  VPN whose other private traffic is now blocked; off therefore has no DNS permit. (b) Keeping `tono-multicast` and
  `tono-ssdp` when off: they are local-network discovery (Windows rule I groups them with its LAN permit), and with
  unicast to the found device blocked they only announce the Mac. (c) Adding narrower MLD, DHCPv6 or unicast DHCP
  renewal passes when off: each would be a new rule shape under review; the costs are listed below instead.
- Why stricter: off adds no pass and removes eight; on is byte-identical to main. Missing or malformed input never
  widens: an old app sends no field (off), a non-boolean is refused, and an older helper rejects an arm carrying the
  field (the app also replaces any helper whose version differs before arming). Costs while connected with the
  setting off, recorded here: the router page, printers, NAS, AirPlay/casting targets and LAN peers are unreachable
  (mDNS still lists them); IPv4 unicast DHCP renewal falls back to the broadcast rebind; DHCPv6 and MLD reports are
  dropped (no IPv6 leaves the tunnel anyway; IPv6 mDNS may stop on an MLD-snooping switch); private destinations of
  another VPN running beside Tono are blocked. Windows parity: Windows rule I (decision 048, #1355) still permits the
  same ranges while connected and has no setting, so the D3-A premise "Windows does not permit this" is out of date;
  after this change macOS off is stricter than Windows and macOS on matches Windows' shape. A Windows setting is a
  separate task.
- Applied in: PR #1506, backlog A29, branch `amp/a29-lan-devices-toggle` (helper 4.52.45).
