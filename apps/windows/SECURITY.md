# Security policy

## Invariants

These must hold for every build, and every code review checks them:

1. **Fail-closed by default.** When protection is wanted and anything is
   uncertain — crash, reboot, corrupt state, network change — traffic is
   blocked, never allowed directly.
2. **The service is the only protection authority.** The UI cannot arm,
   disarm, or weaken WFP or DNS state except by requesting an explicit,
   authenticated Disconnect/Sign-Out/Quit.
3. **No unauthenticated trust of server data.** Catalogs are
   revision-monotonic and SHA-256-pinned; server YAML contributes only
   whitelisted node fields; the last verified catalog survives any failure.
4. **No DIRECT fallback.** The runtime contains exactly one egress group
   and `MATCH,Tono-Exit`. Loss of all nodes means loss of connectivity.
5. **Secrets hygiene.** Access tokens live in memory; refresh tokens live
   in Windows Credential Manager; the controller secret is random per start
   and never persisted; no token, node credential, Reality key material,
   signing key, or live endpoint is ever committed to this repository.
6. **Scoped system impact.** Emergency disarm and uninstall remove only
   Tono-owned WFP objects, Tono DNS state, and Tono runtime files — never
   Windows Defender Firewall policy or third-party rules.
7. **Truthful UI.** `Connected` is shown only after controller, WinTUN,
   protected DNS, and egress probes have all passed.

## Threat model (and explicit non-goals)

Protected against: network adversaries observing or blocking direct
egress, accidental leaks during crashes/reboots/roaming, DNS leakage
outside the tunnel, server-delivered config injection, rollback of the
node catalog.

Not protected against: the machine's own local administrator, a
compromised Windows kernel, physical access, or a malicious build of the
client itself.

## Reporting

Report vulnerabilities privately to the maintainer (see repository owner
contact). Do not open public issues for security-sensitive findings. Note
that this repository must never contain live credentials or endpoints —
reports should use redacted examples.

## Third-party components

- Mihomo is a separately distributed, separately licensed executable. It is
  staged with SHA-256 verification and, in signed builds, Authenticode
  verification.
  - Those checks run on the App-driven planning path (`prepare_runtime` and
    `stage_runtime`, both via `validate_core_path`). They do **not** run on the
    two paths that keep the core alive without the App: the watchdog respawn and
    the boot-time desired-state restore both reach `start_core` with a persisted
    path and spawn it unverified. A binary swapped at that path after the first
    verified start is therefore relaunched at every boot, and inherits the WFP
    app-id permit bound to the path.
  - This is defence in depth rather than a boundary: reaching that state needs
    write access to `%ProgramFiles%\*\tono` or to the SYSTEM-only state
    directory, and an adversary with either can equally replace the Service
    binary that carries the compiled-in pin. It is recorded here because this
    document previously claimed "before every start", which is not what the code
    does. Moving the gate into `CoreManager::start_core` is the fix; it needs the
    unpinned case decided first, since an absent pin is currently a hard refusal
    and no pin exists in test or standalone environments.
- The Clash Verge Rev forks provide GUI/service infrastructure; Tono's
  product layer replaces their configuration trust model as documented in
  `docs/product-contract.md`.
- Kill-switch design references: Proton VPN (`ProtonVPN/win-app`) and
  Mullvad (`mullvadvpn-app`). See `docs/wfp-kill-switch.md`.
