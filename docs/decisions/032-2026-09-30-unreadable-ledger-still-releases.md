## 2026-09-30 · Should an unreadable update ledger refuse emergency network release?

- Status: provisional
- Chosen: no. `--emergency-disarm` releases PF and attempts DNS restore, and leaves the ledger bytes in place. `--emergency-reset` does not remove the install when the ledger cannot be trusted, but it still releases the network. Rejected: #691's bootout of every `pfctl`/`networksetup`, requiring DNS verification before opening PF, and a durable flag that stops later helper starts. That draft stays untouched.
- Why stricter: recovery cannot be refused by evidence the helper cannot read. Nothing is deleted. Launch does not re-arm, and a DNS restore failure still releases PF.
- Applied in: [#711](https://github.com/raydocs/tono/pull/711) (`main.swift`).
