| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| T4-INSTALL-MISSING-ARG | A trailing lifecycle-test option without a value loops forever after failed shift | fixed(2ec556fd) | [#892](https://github.com/raydocs/tono/pull/892) | 低·已确认 | P3 operator only; no runtime/helper contract change |

The zsh runner has no `errexit`. With one trailing `--app`, `--script` or `--expect-version`, `shift 2` fails and leaves the argument vector unchanged; the loop repeatedly reports the failure before any privileged work. Refuse fewer than two remaining arguments with usage and exit 2. One subprocess regression executes the entire production script with each missing value and a timeout; no root/network/file mutation paths are reached.
