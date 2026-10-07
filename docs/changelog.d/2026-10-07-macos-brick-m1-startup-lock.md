## 2026-10-07 · macOS BRICK-M1 启动锁与普通安装守卫
- 归属：SHIP_PLAN §2 item 10，G2 macOS helper 启动/安装恢复。
- 来源：`f2cb79522` → root 集成 `e0bca2fd` → #1444 审查续修工作树；待 CI/复审，尚未合 main。
- 缺陷修复：正常更新 store 打不开时，启动失败的保护意图读取只在验证 `/Library/Application Support/Tono/Updates` 及其父目录、取得相同 root 更新锁后进行；不安全目录或锁不作无锁读取，也不新装 PF 屏障。普通安装的查询与执行守卫共用准入规则：仅无活动事务或已提交事务准入。
- 新增/优化：helper 协议 4.52.41 → 4.52.42，强制升级到包含启动锁/安装守卫修复的 helper。
- 工程与测试：新增一个 XCTest，通过嵌入的 helper 运行只读安装策略自测入口，核对真实 Attempt 的 reserved、staged、consumed、replacing、rollingBack、rolledBack、replaced 未提交状态均拒绝，并核对 nil/committed 准入。保留已有 helper update 自测；本 MacBook 不运行 native XCTest、helper 构建、自测或安装。
- 验证：e0bca2fd 的 CI37693668735 macos/build 失败（遗漏源合约导致 build-source dirty）；该失败未冒充已过。续修静态重算 CONTRACT 后待新 head 托管重跑。本源码 checkout 仅执行 `git diff --check`、限定路径 diff 检查与锁次序静态检查；结果见工作记录。hosted native XCTest/`--update-self-test` 待 root 集成后执行，未将读码当作红绿测试。
- 候选/发布：仅源码，无新候选、包、签名或发布。
- 剩余限制：普通安装对活动 consumed 账本保守拒绝；需按 BRICK-M1-INSTALL-GUARD-RECOVERY 设计显式验证与退休。#691 紧急命令仍需 store，须另作恢复架构；更高 schema 的回滚构建仍无法读账本/启动，须跨版本设计；不安全/缺失的更新目录或不可建立的锁不能作为可信意图来源；失败释放为尽力而为；真实 PF/DNS、bootout 竞争及硬件开机/普通安装未实机验证。本轮已实现部分标 in-PR；#691 与更高 schema 剩余项仍 open，不能标 fixed。

2026-10-07 #1444 审查续修：撤销 consumed blocked/断开请求的普通安装放宽；该路径会在账本活动时改写原始组件，使 `retireResolved` 的组件证明永远失败。保留启动锁修复，恢复需求另记 open。helper 4.52.42 源码合约按 `build-core-helper.sh` 的完整有序清单及注释/空行过滤静态重算；无 native 编译或设备验证。
