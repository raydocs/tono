| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ANDROID-A140-ACCOUNT-EPOCH | 旧认证/目录 IO 在取消或切换账号后仍可提交令牌和缓存 | in-PR | [#1673](https://github.com/raydocs/tono/pull/1673) | 高·推导 | AccountWorkQueueTest；账号 epoch/登录请求 fence/串行 refresh，待云执行，未观察实际跨账号泄露 |

来源：冻结 a140bac84dd692781e36dbfd5a86f9ea2d1356a0 的第 1 轮 GPT 独立盲评。修复仍在 WIP，尚未验证、未合 main；不宣称否决已清除。
