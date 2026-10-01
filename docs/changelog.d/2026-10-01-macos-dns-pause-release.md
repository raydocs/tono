## 2026-10-01 · macOS DNS audit pauses release the network instead of holding PF
- 归属：SHIP_PLAN §2 item 10；macOS App 连接中 DNS 审计（网络变化 / DHCP 后的重新核对）。
- 来源：origin/main 509ebde2；分支 claude/r4-mac-dns-pause-release；源码 PR，未合 main。
- 缺陷修复：MAC-DNS-PAUSE-HOLDS-PF。第三次 Protected DNS 审计失败和 split-DNS 冲突以前走保留式拆线、不排重连，非严格 Mac 断网约 30 秒（DNS 指向已停的 127.0.0.1），helper 看门狗释放后 UI 仍称在拦截。现在两处都走自动失败释放（`releaseAfterFailure`，保留 AI 拦截），不排重连，文案改为「已回到原来的网络，AI 服务继续拦截」（决定 031）。
- 新增/优化：无。split-DNS 冲突仍结束会话（暂定产品决定未变）；前两次 DNS 失败仍保留式重连。
- 工程与测试：新增 `ProtectedDNSPauseReleaseTests`（两条：DNS 三振、split-DNS 冲突），断言只调用一次 `releaseAfterFailure`、不显示 Protected Offline、不排重连；旧代码调用 `restrictToBootstrap`，第一条断言失败（按代码推理，未实跑）。
- 验证：本机不运行 xcodebuild（所有者规则）；以 hosted CI macOS TonoTests 为准。
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：needs-hardware：DHCP 改 DNS、企业 VPN split DNS 下的真机释放与 AI 拦截。
