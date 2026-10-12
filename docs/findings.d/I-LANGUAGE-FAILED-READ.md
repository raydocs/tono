| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| I-LANGUAGE-FAILED-READ | Windows 偏好读失败后的模板可在退出自动保存时覆盖恢复可读的个人语言文件 | in-PR | [#1561](https://github.com/raydocs/tono/pull/1561) | 中·推导（Sol M2，真实持久化调用链） | 保存入口保留失败读锁，显式白名单用户编辑才解除；一条真实临时文件/draft 回归待 hosted Rust 执行，不宣称 before/after 原生通过 |

退出/重启调用 apply_all_and_save_file，经同一 save_file/save_to 原子写入口。读失败 marker 不从文档/IPC 接收、不序列化，自动 patch 与 draft commit 不解除；成功重读可正常保存。白名单、安全字段和保护/transport 代码未改。
