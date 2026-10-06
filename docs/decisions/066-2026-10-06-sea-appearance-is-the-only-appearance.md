## 2026-10-06 · Does 0.0.75 keep a way back to the old appearance?

- Status: provisional (owner in chat, 2026-10-06, to the Claude session: "和合并的全都合并到 main 只用新外观就好了";
  the owner can set `owner` here)
- Chosen: no. On Windows the new appearance is the only one a user can reach: the switch in Settings → Appearance is
  removed, the first-frame flag is always set, and a stored "off" from a pre-release build is not read. The Motion
  choice stays. Rejected: keeping the switch (decision 065's "An explicit off … is kept"), and honouring a stored off
  with no switch to undo it (a device would stay on the old look with no way out).
- What this changes in earlier decisions, without editing them: the "switch stays" clause of 065 and the opt-in clauses
  of 055/063. 065's merge authorisation and its gates stand.
- The agent's reading, to be corrected by the owner if wrong: "只用新外观" is about what the customer gets, not an order
  to delete code in this release. The old-look code and its tests stay, reachable only inside one window (its tests),
  and are removed in a dedicated cleanup after 0.0.75; deleting them inside a product fix was the larger, riskier diff.
- Why this is the stricter side: no protection, connection, routing or privileged semantics move; the only state removed
  is a presentation preference.
- Not verified: no Windows / WebView2 run by the owner yet. macOS (#1405) belongs to the Codex session, which was told
  the owner's sentence; whether its switch goes is recorded there.
- Applied in: this PR (`AppearanceCard.tsx`, `appearance-preferences.ts`, `index.html`, release notes 0.0.75).
