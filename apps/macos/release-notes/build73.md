# Tono 0.0.73

This is the first public cut. **The backup channel is manual in this version.** Tono does not switch to it on its own.

- Connect on the default path with a named city. After you are connected, the dashboard and Activity should stay on Connected. If they bounce back to retry, copy the diagnostic block and send it.
- If a city will not stay up, you can pick **Backup channel** yourself. It is not turned on automatically, and it is not in every account.
- When a connection fails, the main screen shows a short reason. Support can copy the failed stage and error code for a report.
- The network helper is 3.16.0. Existing installs will ask once for an administrator password to replace it.
- No phone app. No Linux app. macOS 14+.
- Sleep and wake are not certified in this build. If the session does not come back, connect again.
- The first in-app update on a real Mac is still unproven. Keep a way back to 0.0.72 until that is checked.

## Known limits

Source tests and CI do not replace a real install. This build does not promise every website, every bank 3-D Secure page, or every Secure DNS setup.

- [#17](https://github.com/raydocs/tono/issues/17): not every browser Secure DNS, bank 3-D Secure, or post-login payment path is certified.
- [#26](https://github.com/raydocs/tono/issues/26): a full protected auto-update is still unproven. Manual install: disconnect and quit Tono first.
- [#4](https://github.com/raydocs/tono/issues/4), [#5](https://github.com/raydocs/tono/issues/5): metering is not part of this desktop cut.
