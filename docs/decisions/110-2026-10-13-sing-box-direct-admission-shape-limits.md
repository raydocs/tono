## 2026-10-13 · How far does Windows sing-box DIRECT admission go before it is bound to the signed policy?
- Status: provisional (the owner may overturn it; only the owner sets `owner` or `reversed`)
- Chosen: the narrower step. The Service (`apps/windows/service/src/core/direct_admission.rs`) now
  refuses over-broad DIRECT shapes in both cores: a process-path regex is admitted only in the form
  `tono-core` `config::windows_path_regex` writes (`^`, case classes `[Xx]`, the separator class
  `[\\/]`, escaped specials, an optional final `$`) whose decoded path is a drive, a colon and a separator
  plus at least one real path component below the drive root, closed by a separator (an install directory)
  or by the final `$` (one exact file); no length floor, so `D:\A\` and `D:\Lark.exe` stay admitted), so a bare `^`, `^.*`,
  `^.+`, a drive root or any group/lookahead is refused (the DingTalk/Feishu discovery, which unlike
  the WeChat path had no drive check, now yields no rule for a UNC or `\\?\UNC\` install, whose
  regex matches no process and would otherwise make the Service refuse the whole runtime); an exact-host pin needs a name
  with a dot whose last label is not all digits, so `com` or an address is refused. Rejected for this
  PR: binding admission to the signed traffic policy. The App holds the verified policy document and
  its digest at the call (`CapturedTrafficPolicy`), but the Service has no copy of the policy
  public key, no policy decoder and no field on `ReplaceSingBoxRuntimeRequest` for the policy and
  its signature. Binding means a protocol revision, the policy verifier in the Service and a
  Windows-hardware qualification of the rollout, which cannot be done and tested in one PR from here.
- Why stricter: it only removes shapes that were admitted before; the compilers' own output (exact
  pins, signed-app path regexes, reviewed media pins, China suffixes) still passes
  (`the_service_admits_what_both_compilers_emit_for_direct`). It adds no WFP surface, no port and no
  destination. The residual gap stays recorded open as `WIN-SING-BOX-DIRECT-SIGNED-POLICY-BINDING`:
  a request that passes the App identity gate can still name a domain or address the signed policy
  never listed, as long as it is a well-formed, non-protected, non-assistant host and /32.
- Applied in: PR for #1280 (`claude/win-direct-admission`).

### Update 2026-10-13 · the signed-policy binding (PR for #1280, `claude/win-direct-policy-binding`)
- Status: still provisional. The rejected half above is now done for sing-box.
- Chosen: protocol revision 22. `ReplaceSingBoxRuntimeRequest` carries `traffic_policy`
  (`SignedTrafficPolicy { revision, json, signature }`, exactly the bytes the control plane served).
  The Service includes `tono-core` `policy_signature.rs` (and the `direct_domains.rs` suffix list) by
  `#[path]`, so it verifies with the same compiled-in policy public key and the same signed bytes
  (`tono-traffic-policy-v1\n` + json); an embedded `revision` must equal the envelope's. `ed25519-dalek`
  and `base64` are added to the Service's `standalone` and `client` features (lock files updated).
  `direct_policy.rs` reads what the verified document lists, and `direct_admission.rs` admits a rule to
  `Tono-China-Direct` only when the shape check passes and the policy lists it: an exact host and port
  from `domains`/`webDomains`, a UDP media `/32` and port from `mediaEndpoints`, a `domain_suffix` and
  port from `directSuffixes` (or the product suffixes the App always attaches beside native pins, and
  only while `domains` is non-empty), and a process-path-regex rule only while `domains` lists native
  apps (it has no destination; which executable qualifies stays the structural regex check and the
  App's signed-app discovery).
- No policy, a bad signature or a relabelled revision: the DIRECT replacement is refused (`NoPolicy` is
  stricter than the shape-only admission plus warning, and cannot cut the network). DIRECT is optional,
  so the App treats the refusal as a skip and the connection stays on its exit. A document with no
  DIRECT rule needs no policy, so the full-tunnel rollback sends none. The App also skips the overlay
  when the Service reports a revision below 22 (it would admit on shape alone) or when it holds no
  signed response matching the captured revision and digest. A refusal is logged at warn level.
- The other ways a sing-box document reaches the running core (Codex round 1, major): `StartClash`
  and `StageRuntime` bring a new document and carry no policy, so for sing-box they now refuse any
  rule that routes to `Tono-China-Direct` (`admit_new_runtime`, `DirectBinding::NoPolicy`). The App
  launches sing-box with no DIRECT plan and adds the overlay only through `ReplaceSingBoxRuntime`,
  so nothing legitimate is lost, and a shape-only DIRECT document can no longer be staged and then
  become the `previous` a failed replacement restores.
- Unchanged on purpose: the watchdog respawn re-admits the document already on disk through
  `admit_owned_runtime` (shape-only; that document was admitted by `StartClash`/`StageRuntime`
  without DIRECT rules, or bound when `ReplaceSingBoxRuntime` wrote it). mihomo DIRECT
  (`admit_mihomo_direct_rules`, `StartClash`/`StageRuntime` on a mihomo core) stays shape-only.
  No WFP permit, port or destination is added.
- Residual limits (recorded in the finding): the policy names no process, so a process-path rule is
  bound to "native apps are authorised" plus the regex shape, not to a listed executable; a validly
  signed older policy can be replayed by a caller that holds it (the App enforces revision
  monotonicity, the Service holds no revision floor); mihomo is unbound; the rollout is not qualified
  on real Windows hardware.
