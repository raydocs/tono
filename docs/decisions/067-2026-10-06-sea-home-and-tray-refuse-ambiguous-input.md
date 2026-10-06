## 2026-10-06 · What do the sea home and tray do with input that could release protection by accident?

- Status: provisional (agent, under AGENTS "choose the stricter, non-leaking option"; raised by the per-PR reviews of
  #1393, #1408 and #1410; the owner can set `owner` or reverse any line)
- Chosen, new appearance only:
  1. Enter / Space on the home never disconnects and never cancels. While connected or connecting the key does
     nothing; Disconnect and Cancel need their button.
  2. For 600 ms after the primary pill turns into Cancel, a click on it is ignored, so the second half of a double
     click on Connect cannot cancel the attempt it started.
  3. While a confirmation dialog is open, the home's keyboard shortcuts and the window's Ctrl+K do nothing, and Escape
     belongs to the dialog.
  4. The tray offers no Cancel while connecting with the barrier held (`protectionBlocked`); it offers it only when no
     barrier is held. Cancelling there went through Disconnect with no confirmation and would have released a held
     barrier from a flyout.
  5. The line list marks "In use" green only with live protection evidence (`hasLiveProtection`); otherwise the mark
     is neutral.
  6. The recommendation's "use this line" button is shown only while idle.
- Rejected: keeping Enter as a toggle (one stray key releases protection), a confirmation dialog in the tray (new copy
  and a new flow inside a review fix), and green by `uiState === 'connected'` alone (the tunnel can be up while the
  barrier is not, the ledger's "showing protected when protection is released").
- Cost: a user who wants to cancel a barrier-held attempt from the tray opens the main window; a keyboard user
  disconnects with Tab to the button, not a bare Enter.
- Not changed: handlers, native commands, PF/WFP, the old look.
- Applied in: this PR (`sea-home.tsx`, `home-focus.ts`, `TrayPanel.tsx`, `sea-lines.tsx`, `servers.tsx`).
