## 2026-09-29 · macOS kill switch hosts pins when `/etc/hosts` cannot be safely rewritten

- Status: provisional
- Chosen: the helper writes its `/etc/hosts` pins on a best-effort basis at arm, status repair,
  supervisor repair and launch restore. An unsafe file (not a root-owned regular file, group or
  world writable, over 1 MiB, a symlink, not UTF-8, or a lone marker) is never rewritten or backed
  up. A release never waits on hosts: it removes the pins only after the anchor flush and the intent
  removal, and a failure there is logged, not returned. Rejected: refusing the arm on such a file
  (it bricks the release path, BRICK-M2), and normalising the file (rewriting a third-party file).
- Why stricter: no PF permit depends on the pins, so skipping them widens nothing; PF rules are
  rendered the same; no third-party file is rewritten. Cost: pinned names may not resolve while
  protection is on, and stale Tono pins stay inside an unsafe file.
- Applied in: [#679](https://github.com/raydocs/tono/pull/679) (BRICK-M2).
