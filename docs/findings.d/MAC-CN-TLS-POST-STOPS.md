| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-CN-TLS-POST-STOPS | macOS 控制面路径链对 POST（发验证码、验证、刷新）在系统 DNS 路径遇到 TLS 握手失败（`secureConnectionFailed`，如握手被重置）或证书被信任库拒绝（系统 DNS 被污染、指向别人的证书）时直接结束，不再试 pinned 与中继；`TonoAPIClient.exchangeOverPaths` 只按 `shouldRetry` 的「未建连」四个错误码放行 POST | in-PR | [#1519](https://github.com/raydocs/tono/pull/1519)（分支 `amp/cn1-tls-failure-walks-on`） | 中·推导 | 修复：只在路径链上把 URLSession 的 TLS 握手失败和被拒证书（非日期）当作「没有请求字节离开本机」，POST 交给下一条路径；同一路径的重试规则和时钟归因不变。模拟 XCTest，非中国实网；待实机 |

审计（2026-10-10，中国大陆连通性）：A4 登录前探测在启动时把首个可握手的路径设为首选，能绕开多数首登；但探测结果过期、首选失败被清除、或登出后同进程再登录时，POST 仍从系统 DNS 开始，遇到上述 TLS 失败就以「网络在拦截加密连接」结束。
