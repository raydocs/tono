| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SELFHEAL-DOUBLE-RELEASE | Windows 连接失败已完成标准释放后，FailOpen 调用者再按 owner 释放，可能拆掉刚准入的后继 Core/WFP/DNS 而未退休其取消令牌 | in-PR | #798 | 中·推导 | P3，毫秒级竞态；needs-hardware；无覆盖调用者第二次释放的现有纯函数接缝，未加该行为单测；Windows CI 与实机待验证 |

`connection.rs` 删除 `connect_for_generation` 的重复 `release_explicit`；失败代际内的 `fail_connect_observed` 继续调用 `release_explicit_with_guard`，使用 Disconnect 共用的标准释放路径。严格保持与选择性 AI 保持不改。#738 的释放后 AI 阻断层未在本基线，不在此处另建。
