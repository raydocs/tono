## 2026-10-20 · AI/Home 名单加入 Amp（ampcode.com）

- 归属：所有者批准把 Amp（ampcode.com，AI 编码工具）加入 AI/Home 路由名单。此前 `ampcode.com` 不在任何名单里，三层分流下走本机直连；网站能打开，但 WorkOS 登录在大陆网络上失败。
- 来源：`origin/main` →（提交见分支）；分支 `claude/ai-list-ampcode`；未合 main。
- 缺陷修复：三层分流（和 AI 家宽）下 Amp 流量现在走住宅 Home 出口，和 Claude/OpenAI 一样，而不是 DIRECT。后缀 `ampcode.com` 覆盖 `static.ampcode.com` 等全部子域；排在 `cursor.sh` 之后，各份名单顺序一致。`PROTECTED_DIRECT_SUFFIXES` 只收 Claude 一方与其依赖主机，不收 OpenAI 类主机，所以这里不加。
- 新增/优化：无。
- 工程与测试：源头 `direct_domains.rs` 的 `CLAUDE_HOME_DOMAINS` 166 → 167 项；`sync-routing-domains.mjs --write` 重新生成 `ConfigPipeline.swift` 和 `ThreeTierRoutingContract.swift`；`config.rs`、`SingBoxConfigTests.swift` 的必含主机清单、`alpha9-clash-rules.json` 的两份 runtime 名单同步（`/rules` 的 payload 被 sing-box 截断，规则部分不变）；设置页「166 项」文案与测试改为 167。合约文件编入 helper，所以 helper 4.52.62 → 4.52.63，`CONTRACT.sha256` 按 `build-core-helper.sh` 的清单重算（本机用同一过滤逻辑算出，已先在 HEAD 上复现旧哈希）。控制面没有 AI Home 名单，客户端从安装包内取名单，需要新的桌面版本才生效。iOS/Android 合约在各自 PR 分支，之后再同步。
- 验证：`node tooling/scripts/sync-routing-domains.mjs --check` 通过；`routing-domains-sync.test.mjs` 1 通过；`cargo +1.98.1 test -p tono-core` 352+10+1+3 通过、0 失败。macOS XCTest、设置页 vitest 本机未跑，由托管 CI 跑。
- 候选/发布：仅源码，无新候选；helper 升级会弹一次管理员授权。
- 剩余限制：未实机验证 Amp 登录经 Home 出口后恢复。
