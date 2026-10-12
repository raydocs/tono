## 2026-10-11 · decision 091 有界整合预检工具与证据
- 归属：SHIP_PLAN G1/G2；两端首登/恢复/保护的组件证据；非冻结候选签核。
- 来源：基线 [134e126a](https://github.com/raydocs/tono/commit/134e126a12e8c8ace0aa501fc8dd55cea6fbbb5a)；分支 `amp/relay-only-preflight`，独立 docs/test PR，未合 main。生产源码与主线程未推 WIP 不改动。
- 缺陷修复：无新产品缺陷复现；旧 A29 FAIL / A13 排除不作为当前结论。A13 仍由主线程必修。
- 新增/优化：只读、源码绑定的 hosted fault 证据预检 CLI；拒绝错误 checkout、陈旧输入、缺命名结果与可见黑洞 skip。被 capture 隐藏的提前返回明确列为 `unverifiedFaultExecution`，不把 ok 当已执行黑洞。文档、此工具与不参与 hosted native job 的 operator aggregate 显式豁免。
- 工程与测试：一个公开 CLI 回归已注册 operator aggregate；Linux Node 24.18.0 `1 pass / 0 fail / 0 skipped`；未全量构建或运行 aggregate。额外 suite 注册守卫失败，当前与 checkpoint 原始基线同样 20 项未注册，本新增 suite 不在失败列表；未扩修。
- 验证：CLI 退出码 0；沿用 [Windows 38097411275](https://github.com/raydocs/tono/actions/runs/38097411275) / [Mac 38097411277](https://github.com/raydocs/tono/actions/runs/38097411277)，实际 checkout 同为 [eb8909bd](https://github.com/raydocs/tono/commit/eb8909bd3a7905cb7ed5205768483aedfb0fd8e2)。分别核对 16/17 个命名结果；native 未在 Linux 执行。详细场景、输出及证据限度见 [预检报告](../reports/relay-only-preflight-2026-10-11.md)。
- 候选/发布：仅工具和文档，无新包；没有自签核、合并、部署或客户更新源推进。
- 剩余限制：Windows 黑洞预算 test 的成功 stderr 被 capture，fault 执行未确认；完整 DoH 等待取消/新登录、Mac 两黑洞后第三成功 HTTPS/恢复总预算、真实 PF/WFP all-fail+缓存重连仍未验证；三项端到端及国内家宽/老板 G1/G2 证据尚未关闭。不是新的确认产品 bug。
