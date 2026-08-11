# Tono 0.0.46

- Fixed the main cause of API and streaming requests dying while connected: a rotating WeChat CDN address triggered a full runtime reload every few minutes, which severed every established connection. The refresh is now skipped entirely when nothing has used the China-direct route recently, and deferred while a proxied stream is still in flight.
- Assistant routing covers Claude, ChatGPT and Codex, and falls back to the protected exit when the residential hop stalls instead of stranding the request.
- Connecting is faster: the health prime on the connect path no longer waits the full steady-state budget on CDN hosts that never answer a bare probe.
