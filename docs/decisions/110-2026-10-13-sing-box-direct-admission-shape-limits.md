## 2026-10-13 · How far does Windows sing-box DIRECT admission go before it is bound to the signed policy?
- Status: provisional (the owner may overturn it; only the owner sets `owner` or `reversed`)
- Chosen: the narrower step. The Service (`apps/windows/service/src/core/direct_admission.rs`) now
  refuses over-broad DIRECT shapes in both cores: a process-path regex is admitted only in the form
  `tono-core` `config::windows_path_regex` writes (`^`, case classes `[Xx]`, the separator class
  `[\\/]`, escaped specials, an optional final `$`) with at least 12 literal characters, so a bare
  `^`, `^.*`, `^.+`, a drive root or any group/lookahead is refused; an exact-host pin needs a name
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
