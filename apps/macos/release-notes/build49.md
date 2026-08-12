# Tono 0.0.48

- Connecting is substantially faster and routing pins now resolve reliably: the controller client was limited to six connections while pin resolution fanned out one request per domain, so most requests timed out while queued without ever being sent.
- An explicit "Restore internet" can no longer be silently undone by a health check that was already in flight.
- A brief helper restart no longer reads as tampered DNS and tears down a healthy session.
- Routing suffix entries are tunnelled instead of black-holed; they never had a firewall permit, so those hosts previously failed to connect at all.
- Hardening: the control-plane firewall permit is restricted to the helper and the signed app, the privileged socket refuses debuggable clients, and WeChat direct routes require Tencent's signature.
- The helper contract version now advances with the helper's behaviour, so an existing install actually replaces its privileged daemon instead of keeping an older one that predates these fixes.
