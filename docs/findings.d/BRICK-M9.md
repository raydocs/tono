| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M9 | macOS `/etc/pf.conf` 挂钩用 `load anchor "tono.killswitch" from "<Application Support>/Tono/pf.tono.conf"`，开机（含安全模式，系统 pfctl 仍会加载该文件，第三方 LaunchDaemon 不会）把规则文件里的阻断装进内核；规则文件缺失或卡住时主规则集加载失败或停住 | fixed(847e1e02) | [#701](https://github.com/raydocs/tono/pull/701) | 中·已确认 | 磁盘挂钩改为只声明锚点；内核装载用一次性副本。helper 启动不再按保存的状态重新装阻断；Core 未运行时释放。已有旧挂钩要等这个 helper 正常开机跑过一次才改写。改写前的安全模式仍会加载旧规则。未实机 |

来源：brick 审计 2026-09-28（基线 origin/main `c0e7758e`）。2026-09-30：开机不从可变规则文件装阻断；没有用户显式的严格杀开关，所以开机、崩溃和 helper 重启不重新武装。安全模式不跑本 LaunchDaemon。
