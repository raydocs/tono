| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CR4459-codex-F2 | #635 收紧归属后，登录提交时本机标记写入失败只记警告，合法本机会话无标记，下次启动被当成外来会话：登出并释放防护 | in-PR | [#409](https://github.com/raydocs/tono/issues/409)，[#642](https://github.com/raydocs/tono/pull/642) | 低·推导 | 登录改为先写标记、写不进则拒绝（不存凭据，可重试）；标记已写而 `client.adopt` 失败时标记留下；调用顺序无单元测试；未实机 |

来源：合并回归审查（区间 `f2e24512...fb5e8485`，jev-route run `4459fadd`）的 codex:F2，Opus 复核由 major 降为 minor
（触发前提是登录那一刻 `%LOCALAPPDATA%` 下的标记目录不可写，而凭据库与漫游目录写入都成功）。
