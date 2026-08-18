# Tono 0.0.67

Build 67 is a ground-up redesign of the interface, full Simplified Chinese
localization, and one important account fix.

- The whole app speaks Chinese now: every screen, error message, and menu,
  including the errors the network helper reports during startup.
- Sign-in is redesigned: a cleaner welcome screen, email and Apple sign-in
  side by side, a six-digit code that submits itself, and readable error
  messages with a Retry button where one was missing.
- If your account is at its device limit, the sign-in screen now lists your
  devices and lets you remove one on the spot — previously it told you to
  fix it from a screen you could not reach.
- Servers are named by city (洛杉矶, 东京, 盐湖城…) with a landmark icon per
  city — palm, torii gate, castle keep, mountain lake, waterfall — instead
  of a wall of identical entries, and the grid adapts to the window.
- Dark mode is a true black glass; status colors, latency bands, and
  accents are consistent across every screen.
- The connect control shows your selected city and latency, lights the
  Tono mark up when the tunnel is live, and the dashboard names the
  residential line your assistant traffic (Claude, ChatGPT, Grok) uses.
- Switching servers and exporting logs confirm with a toast; latency
  results roll in as they land; motion respects Reduce Motion.

The privileged helper is unchanged, so this update does not ask for an
administrator password.
