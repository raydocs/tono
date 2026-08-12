# Tono 0.0.54

- Fixes WeChat hanging after roughly twenty minutes of being connected. The rule engine kept routing WeChat direct, but a periodic internal refresh revoked the firewall permission those packets need, so they were dropped with no error — the app simply spun.
- Greatly reduces how often that internal refresh runs at all. It was rewriting its pinned addresses whenever a CDN returned a different slice of its address pool, which is normal DNS behaviour rather than a change worth acting on. Each rewrite reloaded the core and severed every long-lived connection, which is the "connection closed mid-response" seen in AI tools and long downloads.
- After a refresh, health checks now wait for the core to answer before running. Previously all twenty probes timed out and traffic that belongs on the direct path was sent through the tunnel until the next cycle.
