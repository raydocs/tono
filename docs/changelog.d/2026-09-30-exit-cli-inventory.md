## 2026-09-30 · Preserve exit-client inventory on CLI failures
- Ownership: SHIP_PLAN §2 item 10; exit-agent metering and revocation reliability.
- Source: baseline `08aac566`; branch `hunt/sol-r3ingest-cli-inventory`; PR pending, not yet merged.
- Defect fix: a CLI timeout/filesystem exception after client mutation previously bypassed #838's inventory persistence. Retain accepted and uncertain roster-issued labels for later revocation, continue remaining revocations, and refuse the round without ACK or usage advancement.
- Additions/optimization: none. Unknown inventory remains unknown; AI-service blocking and strict-mode policy are unchanged.
- Engineering/tests: three narrow regressions cover timeout-applied additions followed by revocation, continued removal after a timeout, and counter-read timeout inventory retention.
- Validation: Linux Python 3.13. Baseline: addition inventory regression failed; removal/counter regressions raised unhandled timeouts. Fixed: full exit-agent suite: 110 tests passed; `git diff --check`. No real Xray, systemd or device transport test performed.
- Candidate/publication: source only; no new package, deployment or publication.
- Remaining limits: durable state write failure still cannot prove inventory saved; initial unknown inventory remains a refused round. Native node behavior requires hardware acceptance.
