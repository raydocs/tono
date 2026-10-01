## 2026-09-26 · Windows: may the installer or the App's repair re-enable a Disabled Base Filtering Engine?

- Status: provisional
- Chosen: no. `tono-service-install.exe` starts a BFE that is only stopped (its start type
  unchanged) and waits out StartPending, before the manual gate's first WFP read. A BFE whose
  start type is Disabled is left as it is: the gate refuses with exit 79, NSIS shows the
  `sc.exe config BFE start= auto` / `sc.exe start BFE` commands, and the App's repair fallback
  text names the same commands. The silent `sc config BFE start= auto` the helper used to run
  (it never ran with BFE stopped once the manual gate read WFP first, b6b42ea0) is removed. Rejected: re-enabling it
  silently (the old behaviour), or after an NSIS Yes/No prompt like the orphaned-block (78) one.
- Why stricter: the installer changes no machine setting the user or their security software
  chose; the user makes that change. Protection is not loosened: an unreadable WFP still
  refuses the gate, and a stopped (not Disabled) BFE installs as before the regression.
- Applied in: [#658](https://github.com/raydocs/tono/pull/658) (H22-O-F1)
