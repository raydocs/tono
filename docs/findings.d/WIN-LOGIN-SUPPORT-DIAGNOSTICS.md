| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-LOGIN-SUPPORT-DIAGNOSTICS | Windows 登录失败的「复制给客服」只保留翻译文案，丢失认证阶段、稳定错误码和传输分类 | in-PR | `fix/windows-login-network-20260930`（PR 创建中） | 低·已确认 | 已提交源码；真实 UI/clipboard 红绿回归与 root 窄复跑通过；精确头托管 CI、独立审查待完成；未 Windows 实机验证，不修首次登录网络可达性 |

- `login.tsx` 的发送/验证 catch 分别保留安全摘要；Copy 只附固定阶段、已知认证错误码及 `dns/connect/tls/timeout/other` 分类，不附原始错误、URL、请求/响应内容或凭据。
- 重试、换邮箱、重新开始和清除登录错误时同步清摘要；原来的用户可见翻译文案及认证互斥、自动提交、防重放行为保留。
- `login-support.test.tsx` 使用真实 services/tono 与 SupportContact，仅 mock IPC/剪贴板边界：断言完整真实 Copy payload、发送与验证分类、重试/重置清除和未知错误隐私。
- 实际在基线 `90cc2bed` 的旧 `login.tsx` 上运行新行为回归：1 failed / 1 skipped，失败明确为 Copy 缺诊断字段；finally 恢复源码后两份登录测试 12 passed。测试使用虚构数据，无客户请求。
