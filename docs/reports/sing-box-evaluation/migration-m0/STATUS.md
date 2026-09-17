# M0 状态刷新：2026-09-14

本批对应 G1/G2 配置与保护合同、G3 安装边界，不关闭任何发布门。
基于 [b48d0741 迁移计划](https://github.com/raydocs/tono/commit/b48d0741a5cd1505878b5f61e5647485393dac30)。
本线程唯一写入 M0；Puck 在冻结后分派 M1，不在本批并发定义接口。

## 来源与分支

执行 `git fetch --quiet origin main release/macos release/windows` 后读取以下固定快照：

| Ref | SHA | 相对 main 的独有 / 落后提交数 |
|---|---|---|
| origin/main | [a605306a](https://github.com/raydocs/tono/commit/a605306a1d41b93035338bd44e58635b5659e7df) | 0 / 0 |
| origin/release/macos | [907151ce](https://github.com/raydocs/tono/commit/907151cea29e9807d28b4d9d928eac542a472575) | 0 / 568 |
| origin/release/windows | [3acbbb20](https://github.com/raydocs/tono/commit/3acbbb20bf26a644b1a8747d049d6800b69eb0ad) | 0 / 576 |

命令：`git rev-list --left-right --count origin/release/macos...origin/main`，Windows 同理。
两条 release 都是该 main 的祖先。没有自动移动或合并 release；M2 前的平台集成由负责人处理。
本批分支 `feat/sing-box-m0-contract-20260914` 从该 main 创建，创建时工作树干净。
原始本地 main 仍固定 [1d00b581](https://github.com/raydocs/tono/commit/1d00b581dffdd98e84821c8789eb0c46b7a21bed)，
A/B/B2/B3、计划分支和原始大产物未更改。

## 相关 PR / issue 的刷新结果

以下是本批开始时的 API 快照，不是持续监控：

| 对象 | 状态与影响 |
|---|---|
| [#184](https://github.com/raydocs/tono/pull/184) | 已合入，journal 原子写/事务修复已在 main；M0 不碰其文件 |
| [#185](https://github.com/raydocs/tono/pull/185) | 已合入，远程构建政策已读；MacBook 不做原生编译 |
| [#179](https://github.com/raydocs/tono/pull/179) | OPEN；head [78859d8c](https://github.com/raydocs/tono/commit/78859d8c8006e9bcb2077ebe11ea6147aaa1b946)，快照中 8 checks SUCCESS；未合入 |
| [#189](https://github.com/raydocs/tono/pull/189) | OPEN，base 为 #179 分支；head [3451ce5c](https://github.com/raydocs/tono/commit/3451ce5c041be60901cbbdcd7b91effd7e8c6e1f)，快照中 6 SUCCESS / 2 IN_PROGRESS |
| [#192](https://github.com/raydocs/tono/pull/192) | OPEN，#171 原生验收文档；head [6b195fad](https://github.com/raydocs/tono/commit/6b195fad6b9045b82a81aa7e51aa3e6656af065e)，无 checks；不是已执行验收 |
| [#26](https://github.com/raydocs/tono/issues/26)、[#171](https://github.com/raydocs/tono/issues/171)、[#181](https://github.com/raydocs/tono/issues/181) | 仍 OPEN；#181 另有 [#190](https://github.com/raydocs/tono/issues/190) workflow 权限证据缺口，源码合入不替代 Windows 证据 |

main 相对计划起点 [5d6f8c89](https://github.com/raydocs/tono/commit/5d6f8c891408d7a775133b9b5e3f2154b8a15875)
有 42 个文件变化：包含上述 journal 修复、构建政策和 ops UI。它们不进入本批修改范围。
Puck 确认其他线程不写 M0；#26/#179 的 installer/journal 语义是未来 M2/M5 依赖，不授权本线程修改。

## 本批与下一批边界

- 本批只写本目录：合同、固定候选 manifest、合成 reference fixture 和验证记录。
- M0 冻结的是 **受限 Reality-only v1**，不是完整迁移。Hy2、DIRECT、家宽等必要能力未实现时必须拒绝。
- 只运行已有固定二进制的有界 `check` 和离线 fixture 校验；不运行 `run`、TUN、监听器或网络负载。
- M1 平台实现尚未开始。Puck 收到冻结 SHA 后分配不重叠路径；共享合同任何变化需单独版本化提交。
- M1 交审后才允许 M2；内部安装包是 M2 的第一产品成果，本批不虚报已生成安装包。
- Mac Studio / Windows 做原生验收；不在 MacBook 编译，不部署，不自动合并或推进客户源。
