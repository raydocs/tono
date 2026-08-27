# Tono 0.0.69

Build 69 fixes protected verification from a China network, and stops the
interface making claims the data did not support. Connection and routing
behaviour is unchanged.

- TUN health checks no longer use system URLSession DNS. Each probe
  resolves on `127.0.0.1:53`, requires a `198.18` fake-IP, and opens TLS
  to that address with the real SNI. Encrypted DNS and a poisoned cache
  can no longer send the probe around the tunnel, where PF drops it.
- The mixed-proxy cross-check uses HTTP CONNECT to the hostname, so it
  also skips the system resolver.
- The privileged helper is still 3.13.0. This update does not ask for
  an administrator password.

Interface:

- Latency was measured once at connect — a cold handshake, commonly
  700–900ms — then frozen for the session. It is re-measured
  continuously now, and a node switch re-measures immediately instead of
  showing the previous node's reading. The dashboard and the node list
  look the node up the same way.
- The connect pill spoke in milliseconds while the card below it spoke
  in seconds. Both use seconds.
- Activity showed a permanent 0 B/s while the dashboard showed real
  rates. Both read the same feed, and an unavailable feed says so
  instead of presenting 0 as a measurement.
- Connection flags matched substrings of the route name, so home
  traffic flew a German flag and WeChat's Tencent hops an Indian one.
  Matching is per-word.
- The active-connections count included the loopback DNS rows the list
  hides, reading 104 above a list of forty. It counts what is shown.
- The connection list was capped without being sorted, so "the newest
  2000" could drop the newest. It sorts by start time first.
- Logs were dropped unless the Logs page was open, so opening it
  mid-session reported zero records. They buffer for the session.
- Untested nodes say so rather than showing a dash, and a card no
  longer uses two words for one state.
- `JP-VLESS-Reality` renders as Tokyo with a city glyph, and the Los
  Angeles node has one codename across both platforms.
- The switch toast and the Activity exit tile use the localized city
  instead of the raw catalog name.
- The rules table no longer prints DIRECT and REJECT verbatim.
- Claude Code has an icon in the app list.

Google, Cloudflare, and Apple remain the three origins; one success is
enough. Controller `/delay` stays advisory.
