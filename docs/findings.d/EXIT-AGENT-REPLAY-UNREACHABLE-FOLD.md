| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| EXIT-AGENT-REPLAY-UNREACHABLE-FOLD | exit-agent 有排队上报时先重放，重放遇 `Unreachable` 直接抛出，本轮已读的计数没折入总量；控制面不可达期间若 Xray 重启，这段用量免计（红测：4,600 字节只计 1,600），完整轮与部分失败轮都会发生 | in-PR | [#1784](https://github.com/raydocs/tono/pull/1784) | 中·已确认（红测） | main 上已存在；修后重放失败先折算再退出；未在真实节点复现 |
