## 2026-09-26 · G4.2 for 0.0.74: is an old-client first hop required before the customer feeds move?

- Status: owner
- Chosen: no. The owner has no device kept on 0.0.67 / 0.0.34; customers uninstall and install
  0.0.74 directly. G4 publishes the owner-accepted kit bytes (success target) to the customer
  feeds, then the owner checks the published build; Windows still requires the release row's
  `verifiedAt` before promotion. Rejected: holding the Windows publish for a pre-promotion
  old-client path (0.0.34's update endpoint is fixed in production).
- Why: owner, 2026-09-26.
