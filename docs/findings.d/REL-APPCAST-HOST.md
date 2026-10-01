| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| REL-APPCAST-HOST | `--expected-host` 会换掉 Sparkle 下载地址的主机钉，同一个值还会套到 GitHub 发布页链接上 | in-PR | [#935](https://github.com/raydocs/tono/pull/935) | 中·已确认 | 签名仍覆盖字节。钉住之后，非默认主机或路径前缀直接拒绝。未实机发布 |

`--expected-host evil.example` 时，`validateEnclosureUrl` 接受 `https://evil.example/download/...`。`buildAppcastUpdate` 把同一个值传给发布页链接，链接也被拉到该主机。修复后下载主机固定为 `releases.afk.ccwu.cc`，路径前缀固定为 `/download/`，发布页固定为 `github.com`。
