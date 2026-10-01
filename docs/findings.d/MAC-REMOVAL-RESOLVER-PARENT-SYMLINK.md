| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-REMOVAL-RESOLVER-PARENT-SYMLINK | The app-removal AI-layer check refuses to follow a symlink only at the last path component; if `/etc/resolver` itself is a symlink, `lstat` and the `O_NOFOLLOW` read still go through it to the target directory | open | [#1302](https://github.com/raydocs/tono/pull/1302) | 低·推导（P3） | Read-only and root-only: a sinkhole in the target counts as present, a missing entry there as absent. No write or privilege path was shown. Fix: open the resolver directory no-follow from a trusted parent, inspect entries relative to that descriptor, and read `.unknown` when the parent cannot be opened safely. |

Codex gpt-6.1-sol high review of #1302 at b7f797f7 (minor). Recorded open under the stop rule rather than fixed in that PR.
