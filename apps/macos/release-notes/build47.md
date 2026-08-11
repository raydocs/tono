# Tono 0.0.47

- The China-direct route can no longer be left permanently proxied: refresh scheduling now notices traffic the route is meant to serve, not only traffic already using it, so a session whose pins failed to resolve repairs itself.
- Connecting resolves its routing pins only once the tunnel's resolver actually answers, instead of racing it and losing most pins for the whole session.
