| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ZC-F1 | 登录和连接失败把换网络、换节点或检查连接当成用户该做的事，且失败后可能一直阻断原网络 | in-PR | [#706](https://github.com/raydocs/tono/pull/706) | 中·推导 | 实机未验证 DoH/备用端口/回环隧道；macOS 除隧道丢失外的健康失败仍保持原释放策略 |

支持码在 `tono-core` 的 `customer_failure`。遥测仍读已有 `TONO_` / `CORE_` 标记，不新增上传。
