# Tono 0.0.75

**The backup channel is manual in this version.** Tono does not switch to it on its own.

- Connect on the default path with a named city. After you are connected, the dashboard and Activity should stay on Connected. If they bounce back to retry, copy the diagnostic block and send it.
- Tono no longer switches to another city on its own when the connected one fails. Pick another city yourself; the one you chose stays chosen.
- After wake, Tono waits a few seconds for the Mac to name its network before reconnecting, instead of failing at once and dropping protection.
- If Tono quits unexpectedly while it is holding your traffic, it relaunches on its own so you are not left blocked.
- Starting the connection is more robust: a rejected start is reported at once instead of waiting, and the network helper is installed or repaired from a checked copy.
- If a city will not stay up, you can pick **Backup channel** yourself. It is not turned on automatically, and it is not in every account.
- When a connection fails, the main screen shows a short reason. Support can copy the failed stage and error code for a report.
- **Tono reports a failed connection and lost protection by default**: the failed stage and error code, never page content. **Network log upload is on by default for new installations.** If you turned it off before, it stays off. It sends the hostnames you connected to, the app that opened each connection, and the matched rule and route, to help us fix unstable connections and drops. It never sends page content, passwords or node secrets. Turn it off in Settings.
- Installing or updating Tono may ask for your Mac administrator password to install or repair the Tono network helper. Approve only a request that names Tono.
- Requires an Apple Silicon Mac running macOS 26.3 or later. There is no Intel build, no phone app and no Linux app.
- Sleep and wake are not certified in this version. If the session does not come back after wake, connect again.
- If an update cannot finish, the dashboard says so. Disconnect, quit Tono, then install the new version by hand.

## Known limits

This version does not promise every website, every bank 3-D Secure page, or every Secure DNS setup.

- [#331](https://github.com/raydocs/tono/issues/331): while Tono holds traffic after a dropped connection, macOS leaves a narrow opening so Tono can reach its own service to recover. That opening is not yet limited to the Tono app. A fix is planned for a later version.
- [#17](https://github.com/raydocs/tono/issues/17): not every browser Secure DNS, bank 3-D Secure, or post-login payment path is certified.
- [#4](https://github.com/raydocs/tono/issues/4), [#5](https://github.com/raydocs/tono/issues/5): metering is not part of this version.
