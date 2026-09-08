# Windows 0.0.72: authorized device acceptance

Status: **not executed on the owner's device**. Hosted compilation, real WFP
filter acceptance, candidate packaging and isolated install/repair/uninstall
evidence are in [STABILITY_0_0_72.md](STABILITY_0_0_72.md). They do not substitute
for the following device scenarios. Do not publish until the applicable release
gates have evidence; in particular the full protected update journal lifecycle
in issue #26 is still incomplete.

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
| Existing-version upgrade | Exact previous version, real connected/disconnected states, durable handoff phases, replacement and first-launch recovery; no false journal commit | Not run; #26 incomplete |
| Login/connect/disconnect | Approved test account, correct catalog/policy and observed protected egress, truthful UI; explicit disconnect restores intended direct access | Not run |
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
