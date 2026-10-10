## 2026-10-10 · macOS: "Allow local network devices" (default off) — what off withholds, and how a failed change stays fail-closed
- Status: provisional (agent for backlog A29 under decision 079 D3-A; the owner authorised the redesign of 2026-10-10, including
  the helper protocol and failure-handling changes, after three review rounds; the owner may revisit)
- Chosen:
  - **Setting.** 「允许局域网设备」 / "Allow local network devices", default off. The arm request carries the optional
    `allowLocalNetworkDevices` field only when on (absent = off; anything but a JSON boolean is refused). The helper
    echoes what each committed ruleset enforces; an app that gets no echo treats the helper as too old for the setting
    and reports an explicit error instead of showing off as applied.
  - **PF, while a tunnel is up.** Off withholds `tono-lan` (out and in: `10/8`, `172.16/12`, `192.168/16`, `169.254/16`),
    `tono-linklocal` (out and in: `fe80::/10`, `fc00::/7`, `ff00::/8`), `tono-multicast` (`224.0.0.0/24`,
    `255.255.255.255`) and `tono-ssdp` (`239.255.255.250` UDP 1900); when the reviewed-bundle permit renders, it is
    preceded by `tono-bundle-local`, which drops root's traffic on the bundle's web ports to `10/8`, `172.16/12`,
    `192.168/16`, `100.64/10`, `169.254/16`, `224/4` and broadcast. Kept either way: `tono-mdns` (UDP 5353 to
    `224.0.0.251` / `ff02::fb` only), `tono-igmp`, `tono-continuity` (interface-scoped, decision 045), `tono-dhcp`
    (broadcast), `tono-ndp`, and every block rule, including the #348 LAN DNS block. On renders exactly main's rules (including the decision 086 relay permits).
    No-tunnel states (disconnected, bootstrap, armed-not-connected, emergency, boot restore) are unchanged. Each change is
    one `pfctl -a tono.killswitch -f` load of the complete anchor (PF holds the old or the new ruleset, never a mix), and
    the on → off swap withdraws range passes, which always takes the machine-wide state flush, so no LAN flow survives it.
  - **Core (sing-box document).** Off rejects `10/8`, `172.16/12`, `192.168/16`, `100.64/10`, `169.254/16`, `fe80::/10`,
    `fc00::/7` ahead of every DIRECT route, and every DIRECT rule that matches by name or process (web-direct suffixes,
    the reviewed app's port rule, UDP 5353) is preceded by a `resolve` of the same match (with the direct outbound's own
    resolver) and a reject of a local answer, so a hostname resolved later at dial time is never dialed into the LAN.
    On adds nothing.
  - **Convergence.** The desired value carries a generation. Every arm and every Core document records the generation
    it applied, or unknown; a result from an older generation never overwrites a newer one. A toggle while connected
    runs one full reload (PF arm, then the Core document) so both move together; the health check repeats that at most
    three times while either lags. A Core older than PF fails closed either way: Core off + PF on is stricter, Core on +
    PF off is held by PF.
  - **Failure.** A re-arm of the live session (identified by the saved, armed state with the same tunnel, which is kept
    apart from the in-memory rule baseline; an unreadable state counts as live) never releases protection on any
    failure. If that re-arm was tightening to off and the replaced ruleset may still pass the LAN (it was on, or is
    unknown), the helper installs the block-all emergency ruleset (one verified anchor load) and reports
    `KILLSWITCH_LOCAL_NETWORK_FAULT`; if even that cannot be installed it stops the Core (its DIRECT dials and the local
    mixed proxy) and reports `KILLSWITCH_LOCAL_NETWORK_FAULT_STOP_CORE`, and the core-down watchdog does not release the
    block while that fault holds. Any other failed re-arm of the live session is reported as
    `KILLSWITCH_LIVE_REARM_FAILED` with the block kept. The fault is persisted beside the saved state with its boot
    session: a helper restart in the same boot keeps the block (no startup leftover release, no watchdog or
    orphaned-session release) and reports it in `/killswitch/status`; a reboot drops it and follows the existing boot
    policy. In the app every held fault (helper fault, too-old helper, failed live re-arm, a failed reload that was
    applying a pending generation) is an Error-like state: protection armed, the Core as the helper left it, no
    automatic release (the exhausted-failure handler and every automatic release hold instead), no automatic reconnect,
    the message in the banner and under the setting. Only the user proceeds: toggling the setting, Connect, or
    Disconnect, which always releases normally (no permanent offline). Once held, only an arm that commits a tunnel
    (the user's reconnect, a toggle's re-arm) or a disarm ends the fault: a bootstrap restriction from an automatic
    preserve teardown does not, a kept live re-arm is latched and persisted like the stricter block, and a sleep or
    wake barrier that fails after its load keeps the block instead of releasing it. While a fault is held, no failed
    arm releases, whatever its tunnel (a bootstrap restriction, an arm after a power barrier saved a no-tunnel state,
    a new tunnel's first arm), and an automatic prompt-free helper preparation whose upgrade is abandoned does not
    disarm it (the block, intent and DNS snapshot stay; the install error surfaces). Without a fault, the first arm
    of a new session and the abandoned-upgrade release keep today's policy.
  - Rejected: (a) a separate LAN DNS permit — #348 is a block, and the only remaining LAN DNS path was another VPN's
    utun, whose other private traffic off blocks anyway; (b) keeping `tono-multicast` / `tono-ssdp` when off; (c) new MLD,
    DHCPv6 or unicast DHCP renewal passes when off; (d) an indefinite heal/retry loop after a failed change (Mullvad's
    error state, which keeps blocking and surfaces the failure, is the model); (e) a narrower private-range block layered
    on the old rules, which would need a second anchor reference in the main ruleset.
- Why stricter: off adds no pass and removes eight; on is byte-identical to main; every failure keeps the block or makes
  it stricter, never looser; missing, malformed or stale input never widens. Costs with the setting off while connected:
  the router page, printers, NAS, casting targets and LAN peers are unreachable (mDNS still lists them); IPv4 unicast DHCP
  renewal falls back to the broadcast rebind; DHCPv6 and MLD are dropped; private and CGNAT destinations of another VPN
  beside Tono are blocked; in the protected fault all traffic stops until the user acts.
- Windows: Windows does **not** block private ranges while connected. Its rule I (decision 048, #1355) permits the same
  ranges and discovery multicast with no setting. This decision does not claim alignment with Windows and does not
  change Windows policy; macOS off is stricter than Windows.
- Known limits: a reboot during the fault follows the existing boot policy (the leftover block is released at helper
  start); a daemon startup failure also releases as before. No real-hardware evidence yet.
- Applied in: PR #1506, backlog A29, branch `amp/a29-lan-devices-toggle` (helper 4.52.48).
