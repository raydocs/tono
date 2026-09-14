# Native execution policy

**2026-09-14 owner decision:** Tono remains public and routine CI uses GitHub's
standard hosted runners. The earlier private-repository/self-hosted onboarding
proposal is superseded. No registration commands or connectivity dispatcher
are active parts of this plan.

- macOS: existing `macos-26` workflows.
- Windows: existing `windows-2025` workflows.
- Portable core, Worker and frontend: existing Linux jobs where configured.
- MacBook: editing, fixtures and focused lightweight checks, not native builds.
- Mac Studio and Windows machine: separately authorized native acceptance.
  Mac Studio is no longer a residential exit.
- `raydocs/tono-build`: private, archived, Actions disabled; do not register
  runners or dispatch builds there.

See [BUILD_AND_TEST](../../docs/BUILD_AND_TEST.md) for exact-SHA verification,
public-PR trust boundaries, installed-device qualification and cache retention.

A future self-hosted exception needs a new owner decision and security review;
never attach a persistent home machine to public PR execution by merely changing
`runs-on`. Runner connectivity is not evidence of successful compilation,
PF/WFP/DNS behavior, signing or protected-update acceptance.
