## 2026-10-07 · macOS 面板与控件打磨 B（进行中）
- 归属：SHIP_PLAN 0.0.75 G1/G2 外观准备；MAC-POLISH-SPEC.md B/M4，仅呈现，无 C/D/Windows/保护连接/helper 改动。
- 来源：A合入main c8911d9c5f84064b525bca29a6f82b9681208834 → codex/macos-polish-b-20261007；B草稿[#1429](https://github.com/raydocs/tono/pull/1429)，未合main。
- 缺陷修复：R1426-opus-F1 = R1426-codex-F1 的缓存树中心缩放露底/复位；首提交将 scene 的 anchorPoint 对齐 renderer 的 (0,0) 原点，仍复用树到拖拽结束/150ms去抖后重烘焙，不改变相位/循环/时钟。
- 新增/优化：M4共用玻璃面板（透明度降级不透明）、四种胶囊按钮、选择、开关、输入/焦点边界、标签、52pt设置/设备行、披露chevron和文字/连接相位强调色，逐页保留原动作与绑定；无C页结构重排。
- 工程与测试：新增一条实际CALayer转换覆盖回归，在放大和缩小中对照view真实bounds，并检查最终重建回到identity；首修21cd5dac由托管run37602601403通过（643 tests/1 skip/0 fail）；新增共享控件原生尺寸/AX绑定窄回归及窗口resize截图待新head托管。MacBook不运行原生测试。未实际运行旧源码失败，不声称已证明红→绿。
- 托管首轮M4：b5776811/run37604782249编译、原生尺寸、resize窗口/树复用及全窗图通过；两条AX绑定用例未找到控件（只遍历host的夹具根不完整），因此ci-gate失败。补上真实window根/激活与原始AX诊断，不改生产动作/不降低断言；新增共用控件正常/三种辅助偏好双语原图夹具待验。\n- AX定位续轮：c87bb72e/run37651378381仍失败，两例原始树均停在NSAccessibilityReparentingCellProxy(full=false)；不能将追加window根宣称已解决。遍历改用公开的modern getter与角色协议，保留原控件名称/真实press返回值/原绑定setter断言，不写proxy类型特例、不跳过用例；新head托管待验。
- 验证：首提交与集成本地git diff --check exit0；B §4全部证据待托管CI和逐图检查，不能沿用A截图作为新控件证据。
- 候选/发布：仅源码，无新签名候选/安装/客户发布；G1/G2由owner验收不改。
- 剩余限制：本阶段不能要求B合并。真实生产WindowGroup截图留首个签名0.0.75候选/G1；A记录的合成CPU/日轮亚像素/固定窗夹具限制保留；A的八个旧发现状态由Claude处理，不修改。
