# Tono 0.0.68

Build 68 stops a working tunnel from being torn down just because one
health-check URL failed.

- Connecting no longer treats Mihomo's `/delay` measurement as proof. Real
  HTTPS through the locked TUN decides Connected.
- The data-plane check races Google, Cloudflare, and Apple. One success is
  enough; a single origin outage cannot fail the session.
- Optional DIRECT policy is applied after Connected, so the first lock no
  longer waits on that rewrite.
- Switching servers verifies the new exit, then rolls back without
  restarting the core if the new path is not actually usable.
- The network helper is 3.13.0: protected DNS uses System Configuration,
  with `networksetup` only as fallback. The first launch of this build will
  ask for an administrator password once.

This is the test candidate for the joint Windows 0.0.35 line.
