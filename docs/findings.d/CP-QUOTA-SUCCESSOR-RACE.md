| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CP-QUOTA-SUCCESSOR-RACE | 配额跨周期新建 successor 行时，两个并发采样可把同一段流量算两次并误记一次 reset | in-PR | 本 PR · `t3/fix-quota-successor-race` | 低·已确认（本地 D1 并发回归） | 仅运维节点配额，不改客户计费；未合 main、未部署；独立高风险审查待父线程完成 |

2026-10-22：在 `d1232520a742b3e747f7b9a228361d696f24a172` 的旧实现上，
`test/ops-quota.test.ts` 的单个 successor 回归实际 RED。测试使用 Cloudflare Workers
Vitest 插件、真实本地 D1 和生产迁移；不 mock SQL、返回行或事务。A 读到旧周期的
100，采样 150 并完成关闭/插入批事务，只暂停批事务结果的返回；A 仍在执行时，B
通过未包装的 D1 读 successor、采样 200 并完成计量；然后恢复 A。
旧实现的后置 SELECT 读到 B 的新状态，把 A 的 150 当作 reset，已有 CAS 也挡不住。

原始失败输出：
```text
AssertionError: expected { used: 250, last: 150, resets: 1 } to deeply equal { used: 100, last: 200, resets: +0 }
Test Files  1 failed (1)
Tests  1 failed | 13 skipped (14)
```

修复：开周期的 INSERT 使用 `RETURNING *`，包括批事务中的 successor 插入，直接返回
插入时快照，不再回读一个可能已被更新的行。A 保留插入时的 last=100/used=0，
B 提交后，A 的既有 CAS 拒绝旧样本；跨界增量仍全归新周期，真实计数器下降仍算 reset。
关闭/插入继续同一事务，插入失败仍回滚关闭；无迁移，无全局锁或额度放宽。

同一回归 GREEN（`1 passed | 13 skipped`，筛选只运行这一条），随后完整 quota 文件
`14 passed (14)`，并额外连续 5 次定向通过；覆盖唯一 open 行、旧周期不改用量、其他节点
不变。已有真实 reset 和插入失败回滚用例也在该文件通过。typecheck、contract、budgets
通过。日志：`/tmp/cp-quota-successor-race/{red,green,quota-file,checks,repeat-1,repeat-2,repeat-3,repeat-4,repeat-5}.log`。
未运行完整 Worker 套件/覆盖率、CI、远端 D1、生产并发或真实节点；未证明生产曾发生此交错。
范围不包括所有并发 rollover 错误路径；两个调用都持有 expired 行时的插入竞争未在此回归验证。
