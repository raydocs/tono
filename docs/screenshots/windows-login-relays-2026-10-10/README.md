# Windows sign-in while protection is held · 2026-10-10

## Source and rendering

- Before production login component and en/zh copy: [2ad39dba3446cc9673d557314c76cb371ac89feb](https://github.com/raydocs/tono/commit/2ad39dba3446cc9673d557314c76cb371ac89feb). Those files are byte-identical at this branch's base 766ebc4e. The screenshot was captured in the synthetic shell before the UI change, not on an installed candidate.
- Every after PNG: [3e3a173361340f9880f2a870ae3b2b9a0b08538f](https://github.com/raydocs/tono/commit/3e3a173361340f9880f2a870ae3b2b9a0b08538f). The archive commit adds documentation/PNGs, not production changes. Earlier 54f captures were replaced, not relabeled.
- Linux orb, Chromium 155, DPR **2**, production LoginPage/i18n/shared query cache in `vite.shell-preview.config.mts`. Native auth, status and window actions use synthetic IO; this is **not Windows WebView2, a native installed app, or real-network/protection acceptance**.
- English/classic 840×900 CSS pixels; Chinese/unknown narrow 660×720. PNGs are unedited, with no compositing or post-render styling. Static sea is the existing product setting.
- Only fixture addresses (`fixture@example.test`, `192.0.2.*`) and the existing public business sender appear. Raw failure URLs, tokens, device IDs and relay endpoints do not enter the displayed/copied relay summary. No personal account, logs, caches, real network request or permission operation is captured.

## Executed checks

- Before: email and Send code disabled; the notice incorrectly required Restore network and claimed relays were blocked.
- After: email/send remain enabled with the protection notice; sending disables email/send; verification disables code/resend. Rejected code is cleared and the code input is available again. `Code sent` remains the existing success announcement, not proof of email delivery.
- New public-UI regression first failed with the generic unreachable message. After: login/support tests **17/17 passed**. It uses the real formatter, IPC wrapper and SupportContact with only IPC/clipboard boundaries simulated. Three failure kinds are deliberately asymmetric and returned in order 2→3→1; private URL/token/device content stays out of the details and copied payload. A following failure without the marker retains the generic copy.
- `pnpm typecheck`: **69 unchecked indexed-access errors / baseline 79**, unchanged budget. Initial new-key compile errors were corrected through the existing `i18n:types` generator. Targeted ESLint passes with zero warnings after normalizing existing test imports; Biome format passes.
- Relay error: retry enabled, details initially collapsed. Keyboard focus→Enter opens the disclosure; Tab focuses Copy for support and scrolls the shell's `main`, not the document. English scrollTop **98**, button bounds **824…856** within 900px; Chinese scrollTop **206**, bounds **644.44…676.44** within 720px. No horizontal overflow. Expanded PNGs intentionally show this scrolled, keyboard-focused state; lower support content is below the initial fold in narrow windows.
- The original preview briefly served stale source; restarting its owned managed service corrected it. A later exploratory navigation used the wrong fixture parameter and timed out on Home; only the corrected `scenario`/`account` matrix above produced the final PNGs.

## Reproduce in the synthetic shell

Run the existing dev-only entry: `pnpm --dir apps/windows/app exec vite --config vite.shell-preview.config.mts --host 0.0.0.0 --port 3015` (use the orb's managed service mechanism for a persistent preview).

Query: `?route=/login&account=signedOut&scenario=protectedOffline&lang=en`.
Use `scenario=protectedUnknown` for unknown protection, `scenario=previous&appearance=old` for the classic previous-session notice, `lang=zh` for Chinese. `authDelay=5000` simulates pending IO; `badCode=1` rejects verification; `relaysDown=1` returns decision 091's documented error format without network IO. These flags are fixtures, not product configuration.

## Archive (one before, twelve after)

| State | PNG |
|---|---|
| Before · protected sign-in gated | [before-protected-signin-en.png](before-protected-signin-en.png) |
| After · protected sign-in available | [after-protected-signin-en.png](after-protected-signin-en.png) |
| Sending · locked | [after-sending-en.png](after-sending-en.png) |
| Code sent · inbox step | [after-code-en.png](after-code-en.png) |
| Verifying · locked | [after-verifying-en.png](after-verifying-en.png) |
| Rejected code · cleared, retry available | [after-code-error-en.png](after-code-error-en.png) |
| Chinese · narrow | [after-protected-signin-zh-narrow.png](after-protected-signin-zh-narrow.png) |
| Unknown protection · narrow | [after-unconfirmed-en-narrow.png](after-unconfirmed-en-narrow.png) |
| Previous connection · classic | [after-previous-session-old-en.png](after-previous-session-old-en.png) |
| Relays unreachable · collapsed | [after-relays-down-en.png](after-relays-down-en.png) |
| Relay details · keyboard/scroll | [after-relays-down-details-en.png](after-relays-down-details-en.png) |
| Relays unreachable · Chinese narrow | [after-relays-down-zh-narrow.png](after-relays-down-zh-narrow.png) |
| Relay details · Chinese keyboard/scroll | [after-relays-down-details-zh-narrow.png](after-relays-down-details-zh-narrow.png) |

## Boundaries and device gaps

`TONO_RELAYS_UNREACHABLE` is the signal for the distinct backup-route error. Without it, keep the existing generic error: legacy armed Service <20 and other request paths are not described as relay-only. Native transport/state wiring belongs to #1553; this UI PR must rebase after it merges and receive exact-head Sol review before ready/merge. No native transport, protection evidence mapping, release handler, WFP, Service revision or permission changes here.

Real Windows 11/WebView2/DPI, actual installed Service generations and WFP, authentic relay-only send/verify/refresh under Protected Offline, all-relay loss and network recovery, real previous-account replacement, actual clipboard/IME/screen-reader/keyboard, auth persistence failures and the final signed combined package remain **unverified**. The previous live connection may stop when signing in with another account; this cost is disclosed rather than promising that every sign-in preserves a tunnel. No new candidate or release, no experience score claimed.
