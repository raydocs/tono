# Windows 0.0.72: authorized device acceptance

Status: **first authorized device pass executed; qualification incomplete**. Hosted compilation, real WFP
filter acceptance, candidate packaging and isolated install/repair/uninstall
evidence are in [STABILITY_0_0_72.md](STABILITY_0_0_72.md). They do not substitute
for the following device scenarios. Do not publish until the applicable release
gates have evidence; in particular the full protected update journal lifecycle
in issue #26 is still incomplete.

## Device checkpoint — 2026-09-08

- Windows 11 x64 build 26200: authorized disconnected **0.0.41 → 0.0.72**
  upgrade with the exact candidate hash below. Existing app and user configuration
  were backed up under a private ACL on the device; sensitive backups stay there.
- Installer returned 0; active Service and Core hashes match the candidate manifest.
  Service is running automatically, GUI did not silently launch, DNS was unchanged,
  and no reboot occurred. Interactive launch displayed 0.0.72 and restored the catalog.
- First UI connect reached Connected; a fresh HTTPS egress request succeeded.
  This is not proof of all residential/protected destinations or fault-time isolation.
  Explicit disconnect stopped Core, restored baseline DNS, and restored direct egress.
- **FAIL: dashboard traffic and Activity both remained in controller retry.**
  Source audit found the plugin runtime/guest IPC namespace `mihomo` disagreed with
  Cargo-generated ACL namespace `tono-plugin-core`. The pending correction aligns
  runtime and packaged guest calls without broadening desktop permissions.
  Four packaging regressions reproduced the mismatch; three actual guest-package
  invocation tests also cover version, traffic and Activity socket open/close.
- A rebuilt candidate and another physical pass are required before accepting that
  fix. The connected update journal lifecycle (#26), fault/sleep/reboot/browser
  matrix and signed package qualification remain **not passed**. Device is left
  disconnected with TonoService running; no uninstall/fault injection was performed.

## 1. Establish a private execution channel

The owner can pair the Windows Orca desktop runtime with the Mac client using
Settings → Remote Orca Servers. Use a trusted LAN or private tailnet; never expose
the Orca port publicly. Paste the access link into the intended client's settings,
not a chat, commit, issue or log. Agent credentials belong on the Windows host.
See [Orca's server setup](https://www.onorca.dev/docs/remote-servers).

Once the owner has paired a host, discover its saved selector rather than
inventing an endpoint:

```sh
orca environment list --json
orca status --environment <saved-Windows-environment> --json
orca computer capabilities --environment <saved-Windows-environment> --json
```

Confirm the remote terminal actually reports Windows before any test. Native
Windows PowerShell is required for Service/WFP evidence, not a Linux/WSL process.
Desktop automation capability and an unlocked interactive session must be
verified separately. Do not assume the existing Mac chat or its worktree moved.

**Before disruptive tests**, record the owner's approved scope: dedicated device
or everyday PC, existing Tono installation/version, test account, permitted
install/uninstall, adapter interruption and reboot window. Arrange a local person
or independent console recovery path. Tono's firewall/DNS tests can disconnect
the same SSH/Orca/Tailscale channel used to control them; a lost channel is not
evidence that a test passed or that cleanup completed.

## 2. Baseline before installing or connecting

Collect these read-only observations locally on Windows; keep the output private:

```powershell
$PSVersionTable
[Environment]::OSVersion.VersionString
[Runtime.InteropServices.RuntimeInformation]::OSArchitecture
Get-Service -Name TonoService -ErrorAction SilentlyContinue
Get-NetAdapter | Select-Object Name, InterfaceIndex, Status
Get-DnsClientServerAddress | Select-Object InterfaceIndex, AddressFamily, ServerAddresses
```

Record existing app/Core/Service versions, browser channels and approved test
profiles. Do not extract owner tokens, credential stores, browser profile data or
customer catalogs to public logs. Preserve original DNS settings and the current
installer/recovery path; do not overwrite an everyday installation merely to
obtain a clean-install result.

## 3. Identify the exact candidate

Hosted candidate run: `34200179397`; artifact `10046504113` (limited retention).
Installer `Tono_0.0.72_x64-setup.exe` has SHA-256:

```text
1c8aa75896c796112f2f09a9b875d4123271f984f8b11973d98c8ffa272623a7
```

Source: `90dde3c771428edc2ab7dce8b7ad75ffe0082e7e`. Check the manifest and bytes
again after transfer, using `Get-FileHash -Algorithm SHA256`. Check
`Get-AuthenticodeSignature` separately: this candidate is not Authenticode or
updater signed. Do not disable SmartScreen or represent it as a customer release.
Any rebuilt or signed installer is a different artifact requiring its own hash
and installation evidence, not a reuse of this hash's acceptance.

## 4. Execute and retain scenario-specific evidence

| Scenario | Required observation | Current device status |
| --- | --- | --- |
| Fresh installation | Exact app/Core/Service identities, Service start, no silent GUI start, functional interactive launch | Not run |
| Existing-version upgrade | Exact previous version, real connected/disconnected states, durable handoff phases, replacement and first-launch recovery; no false journal commit | Disconnected 0.0.41 upgrade passed; connected handoff not qualified (#26) |
| Login/connect/disconnect | Approved test account, correct catalog/policy and observed protected egress, truthful UI; explicit disconnect restores intended direct access | Rebuilt 20bb37f: live traffic/Activity, two connect cycles, protected DNS and explicit DNS/Core cleanup passed; full routing not qualified |
| Core/GUI/Service crash | Protected traffic remains blocked or uses the approved exit, never direct fallback; recovery ownership and diagnostics agree | Not run |
| Sleep/wake, adapter change, reboot | Re-proven current-owner protection after each transition; failed recovery remains explicit and recoverable | Not run |
| Browser DNS | Chrome/Edge standard channels, two profiles, managed-policy precedence, live Secure DNS change and bounded detection/restart behavior | Not run |
| Real traffic/revocation | Approved test residential exit and controlled Web/CLI/OAuth traffic; observed egress and revocation timing, not inference from API rejection | Not run |
| Uninstall/recovery | Authorized cleanup removes Service/runtime and WFP ownership; DNS is compared with baseline, including intentional setting changes during the session | Not run |

`tooling/scripts/test-windows-qa.ps1` is an existing **administrator** QA harness,
not a read-only setup check. It needs the matching integration driver, a prepared
test session, approved protected egress addresses and private packet/log storage.
Read its parameters and recovery guards before execution. Fault injection needs
the explicit disruptive scope; do not assume a default run is network-free.

`test-windows-candidate-install.ps1` is exclusively for disposable GitHub-hosted
runners and refuses local/self-hosted execution. **Do not remove that guard** to
run it on this PC. Its same-version repair did not cover the previous-version
upgrade or connected GUI journal sequence.

## 5. Acceptance record and recovery

For every scenario retain: exact source and artifact hashes, OS/browser versions,
start/end times, expected and observed results, signed/unsigned identity,
privileges, interruptions and recovery result. Mark missing observations as
untested/unknown, not pass. Keep raw packet captures and journal/log files private;
only sanitized aggregate results belong in public issues.

After every fault, prove the final Service/WFP/DNS state through the Windows host
or local console. If remote control disappeared, re-observe rather than relaunch
the test blindly. Failed journal evidence must remain intact; never stamp skipped
phases or delete a failed journal to make upgrade acceptance green.


## 6. Follow-up installed candidate (namespace correction)

Run `34209929299`, source `20bb37f6b0e1d377ebcd9a4ee34585061c138635`,
installer SHA-256
`7cbc7d4b573756c429624467dff17f7a18c4df1021fdda445718d6e2016d4197`,
replaced the first candidate by authorized same-version repair. This is the
currently installed tested payload, not the older artifact in section 3.
Independent NSIS extraction matched the installed GUI, Service, Core and helpers.
The GUI digest is
`454609e7c1fb20a877803dc1e6c44582959c5e7c42672627765b3b8d57fee908`.

Live traffic and Activity, a controlled TLS connection, protected DNS and two
connect/disconnect cycles passed; final DNS restoration and absence of Core were
independently checked through the native driver and OS. No real crash injection,
adapter interruption, reboot, broad packet capture, signing or connected upgrade
was performed. Apps-view domain search is a separately reproduced defect with
local regression coverage; its next rebuilt package still needs verification.
