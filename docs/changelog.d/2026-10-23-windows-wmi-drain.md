## 2026-10-23 · Windows WMI 批次封闸与有限礼让
- 归属：SHIP_PLAN §2 item 10，WIN-RESTORE-ABANDONS-INFLIGHT-WMI；仅 Windows Service DNS/release worker。
- 来源：初始基线 `acafd91c5c6089b68b66f99ddf6550ff44ef95f2`、隔离分支 `t3/21da1cb7`；根线程已集成至 `fix/windows-wmi-drain-20261023`，[#1733](https://github.com/raydocs/tono/pull/1733) 为 draft，未合 main。
- 缺陷修复：RED 脚手架 `a3bdd0619f818287dbf9fe9d9ea8dcf459b78f81` 刻意保留原直接 kill 顺序/无 fence；随后 FIX 启用已裁决 B-prime：独立短 D、按精确 incarnation 永久单向封闸、全目标与有界重扫共用绝对 deadline（礼让最多 10 秒）。进程死亡/未知/超时不退休账本。
- 新增/优化：同一真实 recorded-run 覆盖 retry/fallback；兼容旧账本的可选 creation time/protocol 元数据；仅 worker 使用的完整扫描收据。旧格式/未知协议/已 abandoned 不获 drain 证明；不缓存无墓碑，不增 C 依赖/模式豁免/墓碑回收。
- 工程与测试：恰好一个分阶段确定性回归（RED/FIX 测试块字节相同），定义了真实临时账本/C/D/墓碑，注入 OS 身份、runner、时间/pause、verified kill；正常返回、拒绝 retry、C 下 worker/同 PID 新实例准入，以及 deadline 留账。原有测试未改动。
- 初始源码阶段验证：本机只读语法解析/静态范围与空白检查；**未运行 Cargo，也未取得实际 RED/GREEN**。父线程须在 windows-2025 对 RED 与 FIX 执行 `cargo test --locked --features standalone,client,test`（工作目录 `apps/windows/service`；原 windows-ci service job），并对新单一测试作精确筛选/枚举。
- 候选/发布：仅源码与 hosted 验证，无新候选、签名包、部署或发布；推送及 CI 续记见下。
- 初始剩余限制：finding 当时保持 open；旧/未知/abandoned/本次开机遗留项不因 fence/死亡/等待而退休。精确 SHA 独立高风险审查、编译/实际 RED/GREEN、Win10/11 安装机、SCM/ACL/跨进程 D/PID 复用/90 秒 cap 证据均待父线程与 owner。

### 2026-10-23 · 真实 RED/GREEN 与独立 R1
- 集成 RED `76bb3c0af964e1bf6865d23d34cf05fca2f0770c` / FIX `1d24786a84e325094f5dca0ab81bd0578f559037`。同一完整测试块、真实 recorded-run 与 worker-stop 编排；root 核对七路径和原子任务源码完全一致。
- Red check：run39963653880 在原生构建成功后，唯一新回归于“must consume own settled marker before killing the WMI caller”失败；642 passed / 1 failed。Ran：精确 FIX 的 ci-gate39965161786 成功，Service 主套件643 passed / 0 failed，新回归通过；生产 Service build 与 native DNS apply 检查通过。原始日志由根线程另读确认，运行链接见 finding/#1733。
- 独立 Sol/xhigh R1 覆盖 `e93dc5ba6...1d24786a8`，七项不变量覆盖，无 major/minor actionable finding，approve。后续仅此文档与 finding 记录续记，不改变受审/受测 Windows 树；最终 docs head 门禁另记 PR。
- 状态 `in-PR`，draft 等安装机验证；未知/旧/abandoned 项不退休、不增加恢复成功证明。Not run：Win10/11 真实 SCM/ACL/跨进程争用/混装/迟到spawn/PID reuse/进程崩溃与时限、签名候选、部署发布。本机未运行 native 构建或测试。
