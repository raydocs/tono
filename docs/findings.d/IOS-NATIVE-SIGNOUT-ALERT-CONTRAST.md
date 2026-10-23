| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-NATIVE-SIGNOUT-ALERT-CONTRAST | iOS 26.5 模拟器普通对比度下，原生退出确认框的系统红色文字实测约 3.82:1，低于本轮普通字号 4.5:1 目标 | open | [#1721](https://github.com/raydocs/tono/pull/1721) | 低·已确认（模拟器像素；非实机） | 原生系统 alert，非本轮设置行颜色修正控制；不表示缺少取消或退出误触。需单独验证各字号/系统版本与可行原生方案，未做完整 WCAG 认证 |

2026-10-22：精确源码 b0e88ffa965344827a970838746c972120d74886，Devin macOS/iOS26.5。
实际 PNG 标准模式原生 alert：文字 [255,66,69]、背景 [49,48,50]，比值 3.824619:1；
增强对比度 alert 约 4.943363:1。采样为非抗锯齿内部像素，不是屏幕全域/物理显示认证。
同轮设置行标准 4.643147:1、增强 6.085404:1，原设置行问题已修。
三条 Settings 和两条 AX 测试通过，真实 Cancel/账号保留通过；整体 verifier FAIL 原样保留。
证据目录：~/.local/state/devin-cloud/runs/20261022-230353-wait-2788a48db/attachments/，
contrast-b0e88ff-pixel-measurements.json、capture manifest 与原始测试日志。
一轮 minor 修正后按 stop rule 记录 open；不通过改测试阈值、忽略失败或替换系统控件刷绿。
签名真机、VoiceOver、其他 iOS 版本、真实账号退出、120Hz 均未验证。
