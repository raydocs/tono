| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| TW-R-boot | Windows 启动恢复在 WFP 安装前发布沿用 `verified` 的意图，安装失败后仍保留，远程桌面例外把它当作屏障已装好的证明 | in-PR | [#602](https://github.com/raydocs/tono/issues/602)，[#650](https://github.com/raydocs/tono/pull/650) | 低·推导 | 只收紧远程桌面例外；不确定失败要等下一次实时校验成功才恢复例外；未实机验证 |

Codex 核实 eb551db9 时发现（#602 评论），尚未由第二家复核。修复：启动恢复标记「本次启动尚未证明屏障」，第一次成功的 WFP 安装或实时校验才清除；
ARMED、`verified` 与看门狗重试不变。
