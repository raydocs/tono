| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UNINSTALL-RETRY-RECORD | Windows 卸载未检查程序文件删除失败且允许 helper result 2 后删除卸载记录，并依赖可能已部分删除的安装 helper，导致下一次安装拒绝且卸载难以重试 | in-PR | 本 PR | 中·已确认（源码路径；未实机） | 新卸载器自带 helper、限定固定可信目录，result 2 或程序删除失败返回 1603 并保留记录/卸载入口；补充隔离 Windows 故障注入脚本，尚未执行，不能追溯修旧 0.0.32 卸载包或认定客户已命中 |

范围：SHIP_PLAN G1 / §2 item 10。网络未证明安全仍不删除；不删除设备、不放宽 Up/Down、
不自动清注册表或无记录文件。无记录文件恢复仍需现场证据；已有完整旧布局的原地升级
限制继续由 WIN-0032-0034-INPLACE-UPGRADE 记录，未重复创建为新产品缺陷。

新原生 `--verify-uninstall-root` 在任何卸载状态写入前只读检查真实 Program Files\Tono、
ACL 和全树重解析点，防止自带 helper 让 `_?=` 把删除改向不相关目录；不依赖 ARP，
因此保留下来的新卸载器也可处理记录意外丢失的本安装，但仍需通过全部原生门禁。

回归：模板检查保留失败码/入口/租约；现有 candidate smoke 锁住已停止 Service 二进制
验证 result 2，再锁历史 Core 验证“当前 App/Core 已删、ARP/卸载器仍在”，删除已安装
helper 后重试并再安装，核对账户数据哨兵。仅限一次性 GitHub-hosted Windows runner。
本轮 Linux 无 Windows 编译/NSIS 执行/可见弹窗证据；必须补齐后再考虑候选验收或合并。
