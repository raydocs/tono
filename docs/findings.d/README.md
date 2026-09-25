# 发现分片（findings.d）

每个新发现一个文件，文件名为 `<ID>.md`（ID 中的空格、`/`、`#` 换成 `-`，如 `H17-O-F2-Windows.md`、
`issue-491.md`）。并行 PR 各自新建文件，不再在 [FINDINGS_LEDGER.md](../FINDINGS_LEDGER.md)
表格末尾互相冲突（所有者批准，2026-09-25）。ID 规则、状态值、等级写法和安全类条目的限制
仍以 FINDINGS_LEDGER.md 的「维护规则」为准。

## 格式

文件以一张只含一行数据的表开头，列与总账相同；ID 以表中这一格为准，不以文件名为准。
`refuted` 行也用这六列，依据写在「剩余限制」列。表下面可以写补充说明（续修、复核结论、链接），不进合并表。

```text
| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| H23-O-F1 | 一句话问题 | open | 待开 | 中·推导 | — |

补充说明（可选）。
```

## 状态变化

- 该 ID 有分片：改分片里的这一行。
- 该 ID 只在 FINDINGS_LEDGER.md 表格里：改表格原行，不搬成分片。
- 同一 ID 同时存在时，读取工具以分片为准。

## 阅读

```sh
node tooling/scripts/records.mjs findings                 # 总账 + 分片合并成一张表
node tooling/scripts/records.mjs findings --status open   # 状态前缀匹配：open / in-PR / fixed / refuted / accepted-design
node tooling/scripts/records.mjs findings --id R1-F6
```
