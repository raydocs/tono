# 2026-10-13: windows-packaging test tolerates CRLF checkouts

- `windows-candidate.yml` run 38443865019 (main 4058eb600) failed in `pnpm test:dev-control`:
  `NSIS keeps the failed update recovery copies while a repair install is unfinished` built its
  mutated installer with `\n` literals, but the Windows runner checks `installer.nsi` out with CRLF,
  so the replace was a no-op and the validator returned `null`. ci-gate runs this suite only on
  Linux (LF), so it never saw the failure (LESSONS: candidate-only inputs).
- Fix: the test uses the file's own line ending. Test-only; no installer or validator change.
