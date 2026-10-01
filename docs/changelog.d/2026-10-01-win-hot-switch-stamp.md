## 2026-10-01 · Windows 热切换不再把上一出口的延迟和 IP 记到新节点
- 归属：SHIP_PLAN §2 item 10；Windows App `state.rs`、`probes.rs`、`monitor.rs`、`switch.rs`，发现 WIN-HOT-SWITCH-STAMP。
- 来源：基线 `b341164b` → 本分支实现；Fixes #906；未合 main。
- 缺陷修复：同代际热切换不推进 `connect_generation`。验证阶段和出口身份查询在写入时读取当时的 `selected_node`，于是上一出口的 RTT 和 IP 显示在新节点上。现在测量开始时记下节点名；节点已变则不写入。状态发布的出口 IP、机构、地区也要求该名字仍是当前选择。热切换提交成功后重新查询出口身份并采样一次延迟。
- 新增/优化：无。
- 工程与测试：`a_measurement_from_the_previous_exit_is_not_shown_on_the_new_node`。
- 验证：本机 rustc 1.83 不能编译 edition 2024 / rust-version 1.98，`cargo test` 未执行。由 Windows CI 编译测试。
- 候选/发布：仅源码，无新候选。
- 剩余限制：重采样完成前，新节点的延迟和出口 IP 为空，而不是上一出口的数字。回滚到原节点后，仍带着原节点名字的样本会重新显示。
