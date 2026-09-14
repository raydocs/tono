# tooling/scripts

Repo-level scripts: builds, packaging, provisioning, and the CI checks the
packages call through their own `npm run` entries. Each one carries its usage
in a header comment; this file only documents what more than one package has to
agree on.

## Choose the execution host first

Follow [build and test execution](../../docs/BUILD_AND_TEST.md). Native build,
test and packaging scripts run on designated workers or the existing hosted
CI, not automatically on the maintainer's MacBook. A script named `local` runs
on its caller's machine; it is not an instruction to compile on this laptop.
`build-macos-local-verify.sh --install` also replaces an installed app and is
not a read-only check. Do not run it merely to review UI or docs.

The host-local slot below prevents some concurrent work; it neither dispatches
to remote workers nor authorizes privileged tests. Persistent-worker migration
must not remove the disposable-host guard on the Windows installer smoke.

## with-slot.sh — one machine, several agents

```
tooling/scripts/with-slot.sh <lockname> <max> -- <cmd…>
```

Runs `<cmd…>` while holding one of `<max>` slots named `<lockname>`, waiting
until one frees up. It exists because several sessions can be working in
different worktrees of this repo at the same time, and some things do not
survive being run twice at once — a Playwright run drives real browsers, a
`wrangler dev` binds a port, a device farm has as many seats as it has.

The slots are `/tmp/tono-<lockname>.<N>.lock`, `N` from 1 to `<max>`, shared by
every worktree on the machine. With `flock` on `PATH` they are files held open
for the life of the command, so the kernel releases the slot even if the run is
killed. Stock macOS has no `flock`, so there the slots are lock directories
created with `mkdir` — atomic everywhere we run — each holding the owner's pid,
which lets a slot left behind by a killed process be reclaimed instead of
blocking the machine.

The command's own exit status is the script's; 75 means it gave up waiting.
`WITH_SLOT_TIMEOUT` sets that wait in seconds (default 3600, `0` waits
forever), and `WITH_SLOT_QUIET=1` drops the "waiting for a slot" line.

Wired up today:

| caller | slot |
|---|---|
| `services/ops-console` → `npm run test:e2e:locked` | `playwright`, 1 |
