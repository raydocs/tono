| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| W9-RESOURCE-CANCEL-REPAIR | Windows：取消后续重试向导会放掉前一次失败安装保留的租约，App 修复可用较新资源配回滚后的旧 Core | in-PR | #1055；`claude/win-update-p2` | 低·推导 | 待实机（NSIS 向导取消）；契约测试只检查 NSIS 模板；继承的租约保持到一次安装完成；“继承”判定在 begin_manual* 接管之前读取，两个安装器在极窄窗口内并发时可错判（Codex 第 2 轮 MINOR，修复需改 core/update.rs，与 #1307 冲突，留待后续） |
