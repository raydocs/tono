# Tono 0.0.64

Build 64 is the first Sparkle update since 62. It is the routing, Activity, and connect release: WeChat stays in China, Claude and the other assistants use your home line when the catalog has one, and the traffic page finally shows which app used which path.

## Claude, ChatGPT, and the other assistants

- When your account has a home route, browser and Claude Code traffic to `claude.ai`, `claude.com`, `anthropic.com` and Anthropic's own addresses (`160.79.104.0/21`) stay on that residential hop instead of falling through to the datacenter exit. Claude Code's versioned launcher (`2.1.x`) is matched by install path, so the desktop app and the CLI are not split across two networks.
- Perplexity and Gemini product hosts take the same residential hop. Search, YouTube, and `gstatic.com` stay off it.
- IPv6 stays off. TUN and fake-ip are IPv4 only; AAAA dials are dropped by the kill switch and the client retries IPv4. That is enough for Claude today — every audited destination has been `160.79.104.10`.

## WeChat stays on the direct path

- WeChat's main channel runs on port 80. That port was being sent through the protected exit, so on a connection from China it was making a round trip to the United States. Two logs from one account showed 82% and 72% of WeChat's connections leaving through the exit; both now go direct, with the exit still there if the direct path fails.
- WeChat is found wherever it is installed. Tono matched only `/Applications/WeChat.app`, so a copy in another folder or under `微信.app` matched nothing. One account had 342 of 342 connections routed through the tunnel while the app reported China-direct as active. The app is identified by its Apple-issued signature; location, folder depth, volume and bundle name no longer matter.
- Claude and ChatGPT are likewise found under `~/Applications`, and Claude Code is recognised from npm, pnpm or Homebrew. A non-standard install used to leave the desktop helpers on the datacenter exit while the command line used the residential address.
- The direct-path health check now tests a WeChat server on the same port as WeChat's own traffic.

## Activity

- Activity opens on a per-app view: every app that has used the network this session, sorted by traffic, with a bar for direct, residential, and tunnel. The old connection list is still under Connections. Cards above show exit latency, upload and download, active connections, and the session split by route.
- Claude, Claude Code, ChatGPT, Codex and WeChat helpers group under one row each. WeChat China-direct is coloured as direct, not proxy. The residential bar counts a catalog `homeProxy` node, not only the SOCKS5 chain.
- A healthy Claude home route is no longer recorded as unclassified.
- The Activity page follows the system language, including Chinese.

## Connecting

- Switching exits, reconnecting, and refreshing routing no longer drop every other connection on the Mac. Withdrawing one permitted address used to clear every tracked connection; it now clears only the address that changed. One account was seeing that every 3.7 minutes.
- Connecting no longer fails when another protection change lands at the same moment. Tono retries once instead of stopping. One account saw that 46 times in five hours, 21 of them a failed connect.
- The connect stages and the Support timing list use the system language. A connection attempt records whether the catalog actually had a home route (`homeSocks5`, `homeProxy`, or `absent`), so a missing binding is visible in the log instead of looking like a client bug.
- Signing in stays valid for longer stretches. Tono renews access before it expires, which removes a recurring interruption every fifteen minutes that was slowest from China.
- If the control plane's address changes, a Mac that is fail-closed with no tunnel can still reach it. Tono remembers addresses it saw while connected.

## Support and updates

- China app-routing updates reach this version without a new build. A routing entry this version does not understand is skipped on its own instead of discarding the whole list. Updates are signed; traffic for Tono's own services and for Claude cannot be moved off the protected path by an update.
- Adds a Network Log Upload setting for the test programme. While it is on, Tono uploads hostnames, the process that opened each connection, and which rule and route it matched — credentials, URL queries and page content removed, TLS bodies never observed. Uploads are linked to your account, readable only by Tono administrators, and deleted after 14 days.
- The Support page can send the newest log segment immediately.
- The exit row on the Dashboard shows the network operator and country again. It had been showing "--" since the address lookup changed its response format.
- Corrects the Aggregated App Routing Research setting, which described itself as on by default while shipping off.
