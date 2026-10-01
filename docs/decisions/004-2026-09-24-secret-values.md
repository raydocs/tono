## 2026-09-24 · Where may a secret value come from?

- Status: provisional
- Chosen: `wrangler secret put` with an owner-supplied value, or a CSPRNG value
  for a Tono-controlled secret the task names for creation or rotation, after
  coordinating its consumers (a JWT key change signs users out; an admin token
  change affects the hub and scripts). Third-party credentials (for example the
  Telegram bot token) are never fabricated. No secret is printed or committed.
  Rejected: every secret value supplied by the owner.
- Why stricter: an agent never invents an external credential, and a rotation
  never happens unless a task names it.
- Applied in: [AGENTS.md](../../AGENTS.md) "Finish the work" item 2.
