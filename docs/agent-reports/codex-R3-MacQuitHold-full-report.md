Normal Quit removes the AI hold, but the existing explicit-Disconnect policy deliberately requires full release. Runtime remains unchanged pending reconciliation.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| MAC-QUIT-AI-HOLD | macOS Quit/helper | P1 | apps/macos/Tono/App/AppDelegate.swift:350 | Successful Quit removes the selective AI floor | Real-unfixed: decision item in #1031; documented explicit Disconnect exception |
| MAC-QUIT-AI-HOLD-WATCHDOG | macOS helper | — | tooling/scripts/core-helper/SocketServer.swift:250 | Watchdog might reinstate the AI hold | False positive: successful disarm deletes the required state file |
| MAC-QUIT-AI-HOLD-WINDOWS-PREMISE | Windows comparison | — | apps/windows/app/src-tauri/src/tono/commands/quit.rs:331 | Connected Windows explicit Quit might preserve AI hold | False positive: explicit release passes false; automatic Service stop differs |

PR: https://github.com/raydocs/tono/pull/1031 — non-draft, needs-hardware applied, auto-merge OFF as required for docs-only decision PR. ci-gate passed for head 6e2fbf931509b5967ccf763b10cb80f6aca6b91d; native workflow jobs correctly skipped for docs-only scope.

Local findings/changelog parsers and staged whitespace check passed. Swift/XCTest/helper self-tests and installed-device PF/DNS checks were unavailable and not run.

False positives: 2. Total hypotheses examined: 3. Focused source audit complete; behavior fix remains pending policy reconciliation. No broader hunt or hardware testing attempted.

Hunter: GPT-6.1 Sol (Codex CLI)
