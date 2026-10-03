| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M6 | macOS 紧急屏障退到把 `pf.tono-main.conf` 当整个主规则集加载后，disarm、reset 与移除释放都不把 `/etc/pf.conf` 装回，系统主规则（`com.apple/*` 锚点）一直被挤掉 | fixed(4f43bfe9) | [#679](https://github.com/raydocs/tono/pull/679) | 低·已确认（条件成立时审计 major） | 释放在删意图、删 hosts 条目之后，若标记文件在且 `/etc/pf.conf` 含 Tono 的两行挂钩，就 `pfctl -f /etc/pf.conf`，状态 0 才删标记；从不写 `/etc/pf.conf`。`/etc/pf.conf` 没有 Tono 挂钩或加载失败时仍停在替换状态；动态 `com.apple/*` 是否保留未实机验证 |

来源：brick 审计 2026-09-28（基线 origin/main `c0e7758e`），opus MAC-9 与 codex MAC-2。续 H19-O-F6（reset 不重载主规则集）。
