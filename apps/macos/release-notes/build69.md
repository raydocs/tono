# Tono 0.0.69

Build 69 fixes protected verification from a China network.

- TUN health checks no longer use system URLSession DNS. Each probe
  resolves on `127.0.0.1:53`, requires a `198.18` fake-IP, and opens TLS
  to that address with the real SNI. Encrypted DNS and a poisoned cache
  can no longer send the probe around the tunnel, where PF drops it.
- The mixed-proxy cross-check uses HTTP CONNECT to the hostname, so it
  also skips the system resolver.
- The privileged helper is still 3.13.0. This update does not ask for
  an administrator password.

Google, Cloudflare, and Apple remain the three origins; one success is
enough. Controller `/delay` stays advisory.
