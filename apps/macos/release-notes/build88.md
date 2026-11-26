# Tono 0.0.87 (build 88)

Requires Apple Silicon and macOS 26.3+.

## Changes since build 87

- **Native update handoff & network safety** (#1860, #1862, #1863): Fixed the SwiftUI `AppDelegate` lookup that prevented macOS updates from quitting the running app cleanly, made the update executor terminate a hung initiating app after the exit wait, allowed abandoned consumed updates to retire without waiting for expiry, and ensured a failed update on an unprotected Mac never installs an AI-blocking hold.
- **Manual DMG recovery & diagnostics** (#1859, #1861, #1864): Allowed manually dragging a newer signed `Tono.app` over a pending update to retire cleanly via Disconnect/Restore internet, improved pending-update recovery guidance, persisted classified failure reports to the local diagnostics log, and added local audit events for traffic-policy rejections. The helper protocol version moves to `4.52.76`.
