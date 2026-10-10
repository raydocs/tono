| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SEA-TRAY-PICKER-CLIPPED | 固定232px托盘中展开全部线路把列表和底栏推到窗口外，键盘用户缺少Escape收起/焦点返回 | in-PR | [#1495](https://github.com/raydocs/tono/pull/1495) | 中·已复现（Linux Chromium synthetic IO） | 原生WebView2、DPI/多屏摆放、Narrator待设备验收；无连接/保护语义变动 |

本轮真实生产TrayPanel/SeaTray的Linux Chromium渲染复现，原始展开截图见
[before-picker-keyboard-en.png](../screenshots/windows-tray-2026-10-10/before-picker-keyboard-en.png)。
修复为窗口内有界滚动列表，底栏固定；九条合成线路通过Tab可到最后一条（scrollTop106，控件top143/bottom171），
Escape关闭并返回summary，合成原生命令记录为空。已有TrayPanel回归新增一条键盘行为检查。
