## Round 9 blind reviews (same baseline `b36d07d`) and round 10 rework

Reviews, committed verbatim with their evidence files in [`894360d`](https://github.com/raydocs/tono/commit/894360d5c303964a2fba3d4c843255312416b560): [Opus 5.5 — 84, fails on the total](docs/agent-reports/2026-10-18-ios-r9-blind-review-opus-5-5.md) and [GPT-6.1 Sol — 86, fails on the veto](docs/agent-reports/2026-10-18-ios-r9-blind-review-gpt-6-1-sol.md). The [note](docs/agent-reports/2026-10-18-ios-r9-blind-reviews-note.md) sets them beside the implementer self-score, which was written before both. **Neither review passes round 9, and the two are not averaged:** GPT's veto (serious state misrepresentation) overrides its total. It is source-derived: GPT did not inject the fault, and no leak is claimed.

| Item | Opus | GPT | Implementer self (not independent) |
|---|---:|---:|---:|
| Hierarchy / one-handed / brand / glass / motion / a11y / authenticity | 17 / 17 / 13 / 12 / 13 / 8 / 4 | 18.5 / 17 / 13 / 13 / 12 / 8.5 / 4 | 18.5 / 18.5 / 14 / 12.5 / 14 / 8.5 / 3.5 |
| **Total** | **84 (fails)** | **86, veto (fails)** | 89.5 |

**The vetoed path, checked in source at `b36d07d`:**
- `setMode` showed the new mode first, and `try?` swallowed a failed save. The extension then reloaded the old file and answered nil, which the app read as success.
- `send` returned nil both for "no answer" and for success.
- A refused reload set `CORE_START`, but a connected tunnel ignores failures, so the screen stayed "Connected".
- **Worse than the review found:** the extension's comment said "the previous graph keeps running". In the pinned libbox (`daemon/started_service.go` 259–284), `StartOrReloadService` closes the old instance *before* it builds the new one. A refusal there leaves no graph running while the tunnel stays connected.
- Findings: `IOS-1672-R9-MODE-APPLY` and `IOS-1672-R9-RELOAD-GRAPH`, both in-PR, medium, source-derived.

Round 10:
- **Mode and line changes show only what the tunnel confirmed** (TonoKit `RouteApply`).
  - The reload reply is explicit JSON: either the settings applied, or a refusal code plus what is actually running. No reply is never treated as success.
  - The extension rebuilds the previous graph after a libbox refusal and swaps its inputs only on success. If the restore also fails, it replies "no graph". The app then shows **Routes stopped**, and Retry rebuilds in place; the tunnel is not cancelled.
  - The screens separate three states:
    - *in effect*: the selected segment, answers, lanes and the exit;
    - *switching*: a spinner on the requested segment;
    - *couldn't switch*: "Couldn't switch to Stable. Still using Three-tier." in Details, with a line on Home.
  - The `.status` reply carries the running settings, and coming back to the foreground reconciles with them.
- **Details:**
  - The mode is two segments above the routes, each with one plain sentence ("AI and video use Tono; the rest goes direct." / "Everything but your local network uses Tono.").
  - The answer names the mode it was computed for.
  - An empty query, something that is not a site, lines not yet loaded, and stopped routes each get a sentence.
  - The field and Check scroll clear of the keyboard.
- **Home:**
  - The gear and Details are two separate glass controls.
  - The session clock appears after the sunrise hand-over.
  - Rates no longer morph into each other on the way out.
  - The status line reads "Protected · Home exit in United States".
- **Increase Contrast** raises secondary and tertiary text (0.66 → 0.86, 0.58 → 0.8).
- **Tests:**
  - TonoKit fault injection: save rejected, no reply, reload refused (previous graph kept), refused with no graph, confirmed.
  - **Red:** with `RouteApply` reverted to `b36d07d`'s contract, 4 of 5 tests fail (8 assertions).
  - New UI tests:
    - editing the site clears the answer;
    - a query that is not a site gets a message;
    - an injected refused reload keeps Three-tier selected and the answer on Three-tier, and Details and Home both say the switch failed.
  - The preview Live Activity is ended and asserted gone. The real-widget test now asserts placement.
- **Not adopted, again:** offline Connect stays tappable; light appearance stays dark.
- **Not done:** reconnecting and partly-working skies still look alike in stills (motion and title differ).
- **Red runs:**
  - [39147800209](https://github.com/raydocs/tono/actions/runs/39147800209) @ `7c52c6a`: the query message was cleared by the newline submit.
  - [39152384717](https://github.com/raydocs/tono/actions/runs/39152384717) @ `a6aba1b`: the test never closed Details. The audit also measured Details' Settings row at 1.2:1 at the sheet's bottom edge.

