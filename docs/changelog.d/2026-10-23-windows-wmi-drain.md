## 2026-10-23 · Windows WMI 批次封闸与有限礼让（源码阶段）
- 归属：SHIP_PLAN §2 item 10，WIN-RESTORE-ABANDONS-INFLIGHT-WMI；仅 Windows Service DNS/release worker。
- 来源：基线 `acafd91c5c6089b68b66f99ddf6550ff44ef95f2`；隔离分支 `t3/21da1cb7`，未合 main、无 PR。
- 缺陷修复：RED 脚手架 `a3bdd0619f818287dbf9fe9d9ea8dcf459b78f81` 刻意保留原直接 kill 顺序/无 fence；随后 FIX 启用已裁决 B-prime：独立短 D、按精确 incarnation 永久单向封闸、全目标与有界重扫共用绝对 deadline（礼让最多 10 秒）。进程死亡/未知/超时不退休账本。
- 新增/优化：同一真实 recorded-run 覆盖 retry/fallback；兼容旧账本的可选 creation time/protocol 元数据；仅 worker 使用的完整扫描收据。旧格式/未知协议/已 abandoned 不获 drain 证明；不缓存无墓碑，不增 C 依赖/模式豁免/墓碑回收。
- 工程与测试：恰好一个分阶段确定性回归（RED/FIX 测试块字节相同），定义了真实临时账本/C/D/墓碑，注入 OS 身份、runner、时间/pause、verified kill；正常返回、拒绝 retry、C 下 worker/同 PID 新实例准入，以及 deadline 留账。原有测试未改动。
- 验证：本机只读语法解析/静态范围与空白检查；**未运行 Cargo，也未取得实际 RED/GREEN**。父线程须在 windows-2025 对 RED 与 FIX 执行 `cargo test --locked --features standalone,client,test`（工作目录 `apps/windows/service`；原 windows-ci service job），并对新单一测试作精确筛选/枚举。
- 候选/发布：仅源码，无新候选、签名包、推送、CI 调度、部署或发布。
- 剩余限制：finding 保持 open；旧/未知/abandoned/本次开机遗留项不因 fence/死亡/等待而退休。精确 SHA 独立高风险审查、编译/实际 RED/GREEN、Win10/11 安装机、SCM/ACL/跨进程 D/PID 复用/90 秒 cap 证据均待父线程与 owner。
