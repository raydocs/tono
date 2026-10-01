## YOUR AREAS (slot W2-sol-leftovers; branch prefix `hunt/sol-misc-`)
Low risk. Do one pass; keep PRs tiny.
- **M14**: `apps/macos/Tono/Views/*`, `Models/*`, `Support/*`. ONLY crash/hang bugs (force unwraps, index out of range, main-thread blocking I/O, retain cycles that leak monitors). No visual changes. If a fix changes UI, label it `ui-review` and do NOT enable auto-merge.
- **O1**: `services/ops-console/src`. Data correctness only (wrong totals, wrong time zones, stale data shown as fresh). Any visible change → `ui-review`, no auto-merge.
- **T4**: remaining `tooling/scripts/*` test runners and helpers (`records.mjs`, `with-slot.sh`, `build-core-helper.sh`, `test-*.sh`).
- **A13 (rest)**: `apps/windows/crates/tono-plugin-core` (mihomo REST/WebSocket client: timeouts, reconnection, parse errors), `tono-logger`.
