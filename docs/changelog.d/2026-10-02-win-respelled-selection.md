## 2026-10-02 · Windows：目录改了服务器名字的写法后不再每次都要求重选
- 归属：SHIP_PLAN §2 第 10 项；Windows App（`tono/catalog_sync.rs`）。
- 来源：基线 `a73e0e18` → 分支 `fix/win-respelled-selection-20261002`，PR #1352；尚未合入 main。
- 缺陷修复：已选服务器在新目录里只是名字写法不同（分隔符、旗帜前缀）时，空闲状态下把选择改成目录里的准确名字。原先标记「需要重新选择」后没有任何路径清除它，每次点连接都被拒。
  关联 WIN-RESPELLED-SELECTION-REQUIRES-CHOICE。
- 新增/优化：无。真正下架、被屏蔽的选择仍换到默认服务器；连接中的会话处理不变。
- 工程与测试修正：回归 `a_respelled_selection_follows_the_same_exit` 先单独推送为 `42bf551b`（红），结果记在 PR。
- 验证：仅托管 CI（cargo test）；未在 Windows 实机上复现。仅源码，无新候选。

### 2026-10-02 续记：已合 main
- 来源合入：#1352，merge commit `4f49338a`，PR 头 `b6108e3e`。该头的 `ci-gate` 全绿：https://github.com/raydocs/tono/actions/runs/37050512411 （`windows / app-rust` 等 9 项成功，services / sing_box / connect_bench 按路径跳过）。红测试 `42bf551b`：run 37048949470（`windows / app-rust` `649 passed; 1 failed`，只有 `a_respelled_selection_follows_the_same_exit` 失败）。
- 独立评审：普通风险（空闲时的默认选择），主会话核对 diff；未做独立评审。合并前 0 个未解决的评审线程。
- 候选/发布：仅源码合入 main。无新安装包，无部署，无客户发布。没有实机验证。
