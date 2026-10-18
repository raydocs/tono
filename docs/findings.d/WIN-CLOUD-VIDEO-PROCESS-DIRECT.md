| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-CLOUD-VIDEO-PROCESS-DIRECT | Home 扩域新增云视频禁止 DIRECT 合同后，Windows Service 的无目的地址 TCP 进程准入尚未要求视频前置保护 | in-PR | [#1572](https://github.com/raydocs/tono/pull/1572) | 高·推导 | 原 Draft 续修两引擎共享准入，完整前置保护可通过、缺失或后移保护拒收；准确 head 原生回归及独立复核见 PR。非已捕获设备泄漏，未合 main、未进入 0.0.76 RC |

来源：[独立 high 审查](https://ampcode.com/threads/T-01a146e2-b18f-73af-8b79-c252ca97f571)，初审准确 head [2a25defc](https://github.com/raydocs/tono/commit/2a25defc545076426043298e98f91ae5fc083a34)，base [345774bc](https://github.com/raydocs/tono/commit/345774bc9b163f5c16af47c37adbc036b0bd11ca)。此门负责排除物理 DIRECT；具体云/Home 目标仍依赖编译器与精确 readback，不把形状准入称为完整路由身份或实机证明。
