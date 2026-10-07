## 2026-10-07 · macOS BRICK-M1 启动锁与普通安装守卫
- 归属：SHIP_PLAN §2 item 10，G2 macOS helper 启动/安装恢复。
- 来源：`f2cb79522` → 本源码提交；待 root 集成、CI/审查与 PR，尚未合 main。
- 缺陷修复：正常更新 store 打不开时，启动失败的保护意图读取只在验证 `/Library/Application Support/Tono/Updates` 及其父目录、取得相同 root 更新锁后进行；不安全目录或锁不作无锁读取，也不新装 PF 屏障。普通安装的查询与执行守卫共用准入规则：已 consumed 且 blocked/断开请求、尚未替换的事务可维修；正在替换、回滚或其他未完成事务继续拒绝。
- 新增/优化：helper 协议 4.52.41 → 4.52.42，强制升级到包含启动锁/安装守卫修复的 helper。
- 工程与测试：新增一个 XCTest，通过嵌入的 helper 实际运行只读安装策略自测入口，核对 blocked/disconnect consumed 准入及 replacing/活跃 consumed 拒绝。保留已有 helper update 自测；本 MacBook 不运行 native XCTest、helper 构建、自测或安装。
- 验证：本源码 checkout 仅执行 `git diff --check`、限定路径 diff 检查与锁次序静态检查；结果见工作记录。hosted native XCTest/`--update-self-test` 待 root 集成后执行，未将读码当作红绿测试。
- 候选/发布：仅源码，无新候选、包、签名或发布。
- 剩余限制：#691 紧急命令仍需 store，须另作恢复架构；更高 schema 的回滚构建仍无法读账本/启动，须跨版本设计；不安全/缺失的更新目录或不可建立的锁不能作为可信意图来源；失败释放为尽力而为；真实 PF/DNS、bootout 竞争及硬件开机/普通安装未实机验证。本轮已实现部分标 in-PR；#691 与更高 schema 剩余项仍 open，不能标 fixed。
