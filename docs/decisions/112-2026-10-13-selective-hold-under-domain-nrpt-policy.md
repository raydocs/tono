## 2026-10-13 · What does the selective AI DNS hold do when domain NRPT policy makes Windows ignore its local rules?
- Status: provisional (the owner may overturn it; only the owner sets `owner` or `reversed`)
- Chosen: detect and report, change nothing. After the hold writes its per-suffix NRPT rules
  (`selective_layer::apply_blocking`), the Service reads the NRPT the DNS Client applies
  (`engine::effective_nrpt_rules_blocking`: the Group Policy store alone when it holds any rule,
  otherwise the local store). If no effective rule carries the hold's sinkhole resolver, the rules
  are not in force; the hold records `TONO_DNS_SELECTIVE_POLICY_SUPPRESSED` and the DNS status
  (`GET /dns/status`, `resolver_policy_warning`, advisory like `TONO_DNS_POLICY_CONFLICT`) carries
  it for as long as the hold is installed. The App folds that field into the diagnostics report
  (`dnsLastError`) and the Support page lists it on the DNS warning row. The hold's own result
  is unchanged: the firewall prefixes still apply and the release is not kept, restored or failed
  because of this. A registry read that fails makes no claim. Rejected: removing or overriding
  enterprise policy, writing a catch-all `.` rule or a catch-all DNS/WFP block, blocking shared
  CDN ranges, and a replacement enforcement mechanism (needs its own product decision and Windows
  hardware qualification).
- Why stricter: it widens nothing. Tono still writes only its own keys, never touches the Group
  Policy store, and trades no ordinary internet for AI blocking. Ordinary internet, strict
  protection and Anthropic's fixed address blocks are unchanged. The gap itself stays: on such a
  machine AI names outside the fixed blocks resolve normally while the hold is the only layer
  (recorded as `R4I1085-SELECTIVE-NRPT-POLICY`, residual open). It is advisory so no gate (update
  admission, startup takeover, the App's lost-response read-back) closes over policy Tono cannot
  change.
- Applied in: PR for #1145 (`claude/win-nrpt-policy-hold`).
