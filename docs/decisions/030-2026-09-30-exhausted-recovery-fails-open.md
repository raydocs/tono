## 2026-09-30 · After login or connect recovery is exhausted, does the machine stay blocked?

- Status: owner
- Chosen: fail open to the original network, unless the user explicitly enabled a strict kill switch (`permanent`). Rejected: keeping the block after every verified-session failure.
- Why stricter: retries do not install filters, change system DNS, or replace routes. Certificate checks stay on. A strict kill switch the user turned on still keeps the block. The cost is a direct path after an exhausted failure when strict mode is off.
- Applied in: [#706](https://github.com/raydocs/tono/pull/706)（`customer_failure`、Windows `plan_failure`）。
