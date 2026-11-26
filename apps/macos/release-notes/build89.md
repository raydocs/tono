# Tono 0.0.88 (build 89)

Requires Apple Silicon and macOS 26.3+.

## Changes since build 88

- **Switch rollback & connectivity verification** (#1868): Kept live connections protected during failed server switches with in-place rollback, added tunnel and local DNS readiness checks, bypassed the delay gate during failed TUN diagnostics so unreachable exits classify accurately, and refused live server switches or reloads while connected in Strict mode.
- **Helper lifecycle, PF & update recovery** (#1866, #1867, #1868): Moved helper protocol to `4.52.78` with mid-launch sync rollback recovery, distinguished empty vs unreadable PF anchors and isolated the update termination fence, retried transient empty helper IPC replies without breaking fail-closed protection, cleared stale pending-update sign-in errors and duplicate restore buttons, and fixed preemptive release/external-release session tracking.
- **Tahoe UI & responsiveness** (#1868): Refined Liquid Glass panel/card stroke contrast, button hover/spring feedback, header typography, switching status indicators, and Accessibility display-preference fallbacks across Home, Servers, Menu Bar, Sidebar, and Sign-in.
