| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-1672-R11-WIDGET-TRUNCATION | iOS 小号主屏小组件在封顶字号（xxxLarge）下状态被截断：「Connection dr…」「Status unavail…」「Last known: Connected at 2:43…」「Home not answerin…」 | in-PR | #1672 | 中·实测（截图） | 修复后按「整行放得下」选布局：先去掉说明行，再去掉计时，再去掉图形；状态与「截至 / 上次已知」行始终保留且不截断，VoiceOver 标签不变。锁屏矩形小组件同理。只在 App 内图库（真实小组件视图）与模拟器截图验证，系统主屏上的真实小组件仍无 App Group |

来源：第 11 轮 GPT-6.1 Sol 可访问性扣分项。
