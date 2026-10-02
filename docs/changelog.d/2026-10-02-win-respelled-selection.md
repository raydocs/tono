## 2026-10-02 · Windows：目录改了服务器名字的写法后不再每次都要求重选
- 归属：SHIP_PLAN §2 第 10 项；Windows App（`tono/catalog_sync.rs`）。
- 来源：基线 `a73e0e18` → 分支 `fix/win-respelled-selection-20261002`，PR #1352；尚未合入 main。
- 缺陷修复：已选服务器在新目录里只是名字写法不同（分隔符、旗帜前缀）时，空闲状态下把选择改成目录里的准确名字。原先标记「需要重新选择」后没有任何路径清除它，每次点连接都被拒。
  关联 WIN-RESPELLED-SELECTION-REQUIRES-CHOICE。
- 新增/优化：无。真正下架、被屏蔽的选择仍换到默认服务器；连接中的会话处理不变。
- 工程与测试修正：回归 `a_respelled_selection_follows_the_same_exit` 先单独推送为 `42bf551b`（红），结果记在 PR。
- 验证：仅托管 CI（cargo test）；未在 Windows 实机上复现。仅源码，无新候选。
