## 2026-10-18 · iOS client: widgets, Live Activity and Control Center switch
- Status: provisional
- Chosen:
  - **One shared status, never invented.** The app (from NEVPNStatus plus its exit checks) and
    the packet tunnel (at start and stop, plus a heartbeat every 5 min) write one
    `StatusSnapshot` to the App Group. Widgets, the Live Activity and the Control Center control
    read it through `StatusReading`.
    - Written within 15 min: shown as the current state.
    - Older: shown only as "last known · time", with no live timer, and the switch reads off.
    - No snapshot: "status unavailable".
    - The DEBUG design preview never writes the snapshot. Its Live Activity and widget
      renderings carry a "Preview" tag.
  - **Restricted command path.** The one outside command is `SetTunnelIntent` (on/off), a
    `LiveActivityIntent` that iOS performs in the app process.
    - It only switches Tono's existing VPN configuration, with On Demand following the switch as
      in the app.
    - A start is refused without an account, an enabled configuration or admitted tunnel inputs.
    - It cannot sign in, change the catalog, the line, the mode or the protection options.
    - The widget extension's own copy always refuses and sends the user to the app.
    - The intent is hidden from Shortcuts and Spotlight.
  - **Live Activity off by default.** It puts the line name on the Lock Screen; the user turns it
    on in Settings. Each update carries a 15-minute stale date, so a session that ended while the
    app was suspended reads "may be out of date", not "connected". No push updates (no APNs
    entitlement, no server work).
  - **Targets.** The widget extension needs iOS 17 (interactive widget buttons, App Intents
    widgets); the Control Center switch needs iOS 18. The app itself stays iOS 16+.
- Rejected: reading NEVPNManager from the widget extension (no session, and Network Extension
  outside the app), and a widget-side tunnel start.
- Open for the owner: signing with a team that has App Groups and the widget extension's bundle
  ID; device validation of the Control Center switch, the Lock Screen widgets and the Live
  Activity's in-app-process intent.
