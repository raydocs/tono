## 2026-09-24 · Does the G1–G3 acceptance cover a different candidate?

- Status: provisional
- Chosen: no. The owner's G1–G3 evidence names the candidate (source SHA,
  version/build, package hashes); customer publish uses only that candidate. Any
  other SHA or version needs new owner evidence, except rebuilding an
  already-published good source as a higher build for rollback. Rejected: any
  0.0.73 build inherits the ticks.
- Why stricter: customers only receive bytes the owner accepted on a device.
- Applied in: [AGENTS.md](../../AGENTS.md) "Finish the work" item 2;
  [RELEASE_LINES.md](../RELEASE_LINES.md#customer-publish-g4).
