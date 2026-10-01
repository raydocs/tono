| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UPGRADE-FIFO-OPEN | 静默升级在 bundle 签名校验之后对用户路径做阻塞 open；无写端 FIFO 会占住更新锁和唯一的 accept 线程 | open | [#928](https://github.com/raydocs/tono/issues/928) | 中·推导 | 不是未签名安装；#763 只改 atomicCopy 和 openInput，不动 SocketServer；要等 #889 的协议号；未实机。issue 正文里的 LaunchServices 路径写错，令牌 403 改不了，正确路径是 Contents/Resources 下的 helper 与 sing-box |
