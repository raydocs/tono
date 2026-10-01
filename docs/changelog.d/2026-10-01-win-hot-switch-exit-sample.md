## 2026-10-01 · 热切换不再把上一节点的延迟和出口地址标到新节点
- 归属：SHIP_PLAN §2 item 10（界面把仍走旧出口的测量显示成新节点）。Windows App 选路。Issue #906。
- 来源：基线 `b341164b` → 分支 `cursor/win-hot-switch-exit-sample-f0e7`，[#945](https://github.com/raydocs/tono/pull/945)，未合 main。
- 缺陷修复：同代热切换不增加 `connect_generation`。`tono_select_server` 先改 `selected_node`，探测返回时 `record_exit_delay` 用当时选中的名字落账，出口 IP 查询也只核对连接代。现在延迟和出口身份都带着测量开始时的节点名，提交时节点已经换了就丢掉，不覆盖仍属于当前选择的样本。用户改选时先清掉显示中的出口 IP。选择器、WFP 和运行时出口不改。
- 新增/优化：无。
- 工程与测试：`a_sample_from_the_previous_exit_is_not_shown_on_the_new_node`。
- 验证：本机 `rustc 1.83.0` 编不过 App crate 的 `edition = "2024"`，未安装更新的工具链，`cargo test` 未跑。由托管 Windows CI 执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：名字已经改成新节点、Core 却还没切过去时，在那之后才开始的测量仍会记在新名字上。热切换失败回滚后，出口 IP 留空，直到下一次查询。
