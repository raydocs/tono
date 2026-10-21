# Tono 0.0.80 — qualification RC (build 81)

Manual-install test candidate for installed-device qualification of AI Home, not stable acceptance. Production update feeds and the 0.0.79 RC remain unchanged. Requires Apple Silicon and macOS 26.3+.

- **Fixed: an account with a Home line could not connect in AI Home or Three-tier** (#1702). Home lines are given as a gateway name (such as `isp.decodo.com`), but the runtime contract accepted only an IP address. Connect stopped at "preparing the secure helper" and showed only "the protected connection failed". 0.0.79 defaults new installs to AI Home, so every new user with a Home line hit this, and Three-tier never worked with these lines. Ordinary public DNS names are now accepted. The cloud node resolves the name; this Mac opens no direct path for it.
- **More AI services go through Home** (#1706). The AI list grows to 194 entries: Amp, Cursor, GitHub Copilot, Kiro and Amazon Q, Windsurf/Codeium, JetBrains AI, Hark, Mistral, ElevenLabs, Midjourney, Suno, Google Labs/Flow/Opal/Stitch, Llama, and the Poe, Perplexity and OpenAI pieces that were missing. They follow your Home line in AI Home and Three-tier, and in Stable when the account has a Home exit.
- The network helper moves to 4.52.63, and its upgrade asks for administrator approval once.
- Everything in 0.0.79 is kept: AI Home as the default for a Mac that never saved a mode; Restore internet no longer loops; a held port is named together with the program holding it, without retries; China Mobile Cloud and the MIIT filing site go DIRECT; the same failure is reported once per ten minutes.

## Install and required tests

Verify the published SHA-256 first. In the old Tono choose Restore internet, confirm ordinary browsing works, quit, then replace `/Applications/Tono.app` with the signed and notarized ZIP. Approve only the normal Tono helper installation. Do not delete the helper by hand or work around a protection or installation refusal; if Restore or helper approval fails, stop and contact support.

AI Home (decision 131), on an account with a Home line: AI exits through Home (exit IP and DNS) and is refused when Home or the cloud is down; ordinary TCP/UDP, LAN and mDNS go DIRECT; after quit, a Core kill or sleep/wake, ordinary browsing stays online while AI stays held; Restore internet clears everything; captive portals and a company VPN beside Tono. Then test Stable and Three-tier as before. Also: connect with Docker (or another resolver holding port 53) running and check that the holder is named and there is no retry; after Restore internet, Connect does not loop. Record the old and new versions, package digest, OS and results. Hosted CI is not installed-device acceptance.

## Known limits

- AI Home protects the listed AI services, not every AI service; ordinary traffic is not filtered. With another TUN such as Clash beside Tono, the conflict is still named only after a failure; there is no pre-connect check.
- On Devin's macOS VM every mode fails at "securing DNS" ("The selected DNS service cannot be identified"). 0.0.79 in Stable connects on a real Mac. The cause is not known; it may come from the VM's network service setup.
- The #1071/#1504 aborted-helper-upgrade AI hold risk remains separate, and #1643 is not included. The PF root UID/NIC scope is not PID isolation, and nothing guarantees the exit before the helper starts at boot.
- G1–G3, upgrades from older installs, real PF/DNS faults, Home second-hop identity and the fixed-candidate trial are not accepted yet. A failed candidate cannot be rolled back by installing the old version over it; ask support for a compatible recovery.
- Existing log preferences are kept; new installs upload network logs by default, which can be changed in Settings. Logs may contain domain and app names, never page contents or passwords.
