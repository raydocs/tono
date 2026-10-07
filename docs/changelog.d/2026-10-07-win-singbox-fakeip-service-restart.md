## 2026-10-07 · Windows Service 自己重启 sing-box 时换 fake-IP 槽位（WIN-SINGBOX-FAKEIP-SERVICE-RESTART）
- 归属：SHIP_PLAN §2 第 10 项（0.0.75 修复批，所有者 2026-10-07）；Windows Service（`apps/windows/service/src/core`）。
- 来源：origin/main `de62eb2a5` → 分支 `claude/win-singbox-fakeip-service-restart-20261007`；PR [#1451](https://github.com/raydocs/tono/pull/1451)；未合 main。
- 缺陷修复：看门狗重启、期望状态恢复、未记录停止后的重启、替换失败后启动上一份文档或重试请求的文档，过去都原样启动保存的字节，新进程从
  上一个进程用过的 fake-IP 段开头重新分配，应用缓存的旧地址对应到别的域名（[#1258](https://github.com/raydocs/tono/issues/1258)）→ 现在这些路径先把
  文档的 fake-IP 段往回挪一个槽位（App 往前数，所以不会落在 App 的下一份文档上），跳过另一个最近进程用过的槽位。只改这一个字符串，
  结果必须解析成「原文档只换了这个值」；不在槽位上的文档（例如 #1333 之前的 `198.18.16.0/20`）原样启动并记警告。看门狗把挪过的副本写进
  自己的 `config.respawn.json`，从不改 `config.json`，不会覆盖替换请求刚写的文档。写入失败算一次失败的重启或返回错误，不在旧槽位上启动。看门狗挪的是退出进程实际运行的字节（`start_watchdog` 时读取，之后是每次重启的字节），
  写之前重新过准入检查；`config.respawn.json` 和 `write_document` 的临时文件名列入运行时资源保留名，暂存的资源不能占用（评审 b57da4e8 codex:F1）。
- 新增/优化：无。Service 没有文档摘要 pin（只有 mihomo/sing-box 二进制 pin）；准入检查和二进制 pin 不变。
- 工程与测试：新模块 `core/sing_box_fake_ip.rs`；回归 `a_service_restart_of_a_kept_document_leaves_the_exited_process_slot`；保留名测试
  `the_names_the_generation_owns_are_refused_whatever_their_case` 加入 Service 写的 sing-box 文件名。
- 验证：本机 `rustfmt --check --edition 2024`（新模块）通过；Python 核对模板只有一处 `"198.18.128.0/20"`、替换后解析相等：`1` / `True`。
  `cargo test` 未在本机运行（所有者规则），只由 PR 上的 ci-gate 证明。
- 候选/发布：无新包，仅源码。
- 剩余限制：App 不知道 Service 挪过槽位，同一份文档被 Service 连续重启七次而 App 没有新文档时，App 的下一个槽位可能等于最后一个进程的；
  替换失败的还原读的是 `config.json` 而不是看门狗的副本（副本的槽位会被跳过）；看门狗先写副本再启动，
  两者之间 Service 崩溃时，期望状态重放避开的是准备好的槽位而不是最后实际运行的（评审 codex:F3，minor）；未实机抓到证书错误（等级仍为推导）。
