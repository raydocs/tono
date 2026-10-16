## 2026-10-13 · Should `--emergency-reset` remove the helper while the AI-service layer is still installed?
- Status: provisional (the owner may overturn it; only the owner sets `owner` or `reversed`)
- Chosen: keep the helper. After a verified release, `--emergency-reset` runs the same
  read-from-the-system check as automatic app removal (`layerProvenAbsent`, with one removal
  attempt first). If the sinkhole resolvers or blackhole routes are not proven gone, it
  re-bootstraps the daemon, removes nothing, prints which resolver files and route prefixes may be
  left, and exits non-zero; running it again later retries. This is the same treatment as a DNS
  restore failure (#1165). Rejected: removing the installation and printing the leftover files,
  which strands an `/etc/resolver` sinkhole for Anthropic and Claude domains with nothing able to
  retry its removal.
- Why stricter: the helper stays (the owner of the retry), and nothing is removed that the next
  start or watchdog still needs. It does not touch PF: protection is already released by then.
  Cost: an administrator who wants the helper gone while a layer removal keeps failing must clear
  `/etc/resolver` entries by hand, or reset again once the failure clears.
- Applied in: PR for issue #1303 (`claude/keychain-signout`), helper 4.52.54.
