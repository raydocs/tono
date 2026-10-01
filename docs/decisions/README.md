# Decision files

One decision per file. [DECISIONS.md](../DECISIONS.md) is the index. It keeps the
headings that were in that file when it was split, so existing `#anchors` still
resolve. The number in the filename is the order: a higher `NNN` is newer and
sorts first. `node tooling/scripts/records.mjs decisions` prints every entry,
highest number first.

## How to add one

1. Take the next number: one greater than the highest `NNN-` prefix already in
   this directory. Keep three digits. Do not renumber an existing file.
2. Add `NNN-YYYY-MM-DD-short-slug.md`. The slug is lowercase ASCII.
3. Start the file with the heading and fields below. Status is `provisional`
   unless you are the owner. Only the owner sets `owner` or `reversed`.
4. Do not edit another decision file. Do not add a heading to `docs/DECISIONS.md`.
   A new decision does not need an index line; the filename number is the order.

Links to other docs are relative to this directory (`../SHIP_PLAN.md`,
`../../AGENTS.md`).

```text
## YYYY-MM-DD · question in one line
- Status: provisional | owner | reversed
- Chosen: the option taken, and the option rejected
- Why stricter: what it does not widen (exposure, data, availability)
- Applied in: PR / commit / command
```
