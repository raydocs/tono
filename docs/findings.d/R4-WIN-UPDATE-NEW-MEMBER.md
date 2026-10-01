| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4-WIN-UPDATE-NEW-MEMBER | 签名正确的 Windows 原生更新包若新增了 sing-box 以外的文件或目录，Prepare 只比组件摘要就放行；执行器在停 Service、关 App、消耗发布序号之后才拒绝，同一版本的原生重试被当作重放，所有原生更新用户只能走手动安装 | in-PR | 本 PR · claude/r4-win-update-new-member-preflight | 中·已确认（P2，读码） | 回归测试只在 Windows CI 跑；本机不跑 cargo。真实安装包的新增成员路径未实机验证 |

Prepare 在组件比对之后、写 Staged 之前，用与执行器 `collect_candidates` 同一条规则（只能覆盖已有成员，外加首个 sing-box）检查 payload 与安装树。这一步早于停 Core，失败时与「组件与签名目标不符」走同一个错误出口：不动网络，不消耗序号，App 不被关闭。
