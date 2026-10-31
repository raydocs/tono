| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UI-03 | Full 档 Metal 水面在所有阶段都以 60 fps 渲染，无热状态输入 | in-PR | PR_LINK | 高·已确认 | 本次：serious 热状态水面降到 15 fps（仍在动），critical 才进入 Static（与降低动态效果同一静帧），失焦 30 fps，完全遮住时暂停。未做：聚焦可见时的 30 fps 环境帧率、1x drawable、首帧后 isOpaque、GPUStartTime/GPUEndTime 计时，因无法证明可见窗口观感不变（所有者约束）；待实机 GPU trace |
