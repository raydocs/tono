## 2026-10-20 · macOS AI 家宽与三层分流接受域名形式的家宽线路

- 归属：0.0.79 测试候选在 Devin macOS 上实测（签名包 build 80，测试账号，家宽 decodo 10080）。连接卡在「准备安全组件」，界面只显示「受保护连接失败」；服务器诊断日志里的真实错误是 `TONO_SINGBOX_UNSUPPORTED_POLICY`。
- 来源：`origin/main` `d590eb9de` →（修复提交见 PR）；分支 `fix/ai-home-socks-hostname`；未合 main。
- 缺陷修复：AI 家宽和三层分流的运行合约（App 编译时和 helper 绑定时各查一次）要求家宽 SOCKS 服务器必须是公网 IPv4 字面量，但 decodo 等家宽线路给的都是网关域名（`isp.decodo.com`），所以有家宽的账号一进这两种模式就失败。0.0.79 新装默认 AI 家宽，有家宽的新用户都会中招；三层分流（0.0.77 起可选）对 decodo 线路也一直不可用。现在合约同时接受普通的公网域名：小写、至少两段、每段 1–63 个字母/数字/连字符、顶级域含字母；`localhost`、`.local`、`.internal`、`.arpa`、`.invalid`、`.onion`、`.alt` 仍然拒绝。家宽这一跳经 `Tono-Exit` 拨出，由云端节点解析域名，本机不为它开直连口子。
- 新增/优化：无。
- 工程与测试：`ThreeTierRoutingContract.publicHostname`；helper 4.52.61 → 4.52.62（`CONTRACT.sha256` 已更新），helper `--self-test` 的运行合约自测加了域名和特殊用途名用例；App 新增 `SingBoxConfigTests.testStrictModesAcceptAHostnameHomeLine`（两种模式编译域名线路，并用打包的 sing-box `check` 验证）。
- 验证：由托管 CI 跑，结果见 PR 验证评论。对照检查：同一份合约代码，修复前对 `isp.decodo.com` 两种模式都拒绝，修复后都接受，特殊用途名修复前后都拒绝（本地独立编译合约文件的小程序）。0.0.79 上把测试线路临时改成 IP 后的实机结果见 PR 评论。
- 候选/发布：仅源码，无新候选；需要新的签名候选（0.0.80）后再实机验收。
- 剩余限制：域名由云端节点解析，需实机确认解析和出口都正确；helper 升级会弹一次管理员授权。
