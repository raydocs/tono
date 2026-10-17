## 2026-10-17 · 0.0.77 双端三层分流客户测试 RC
- 归属：SHIP_PLAN G1–G3 手动客户测试候选；owner明确授权完成#1571、合main并制作全新Win/Mac版本，不授权正式feeds推广。
- 来源：#1571已合main [6ec54b5385cfced8476e2ac1fc0800d13a9a7d66](https://github.com/raydocs/tono/commit/6ec54b5385cfced8476e2ac1fc0800d13a9a7d66)，tree与已审d029相同；分支`release/desktop-0.0.77-test-20261017`。最终冻结SHA/run/包摘要产生后续记，不提前声称构建或验签成功。
- 缺陷修复：本准备提交无新运行时修复；收录#1571晚解析Home CIDR、captured模式恢复、live运行图绑定/strict LAN/持久恢复等已合修复，finding仅标源码fixed，待设备。#1071/#1504/#1605/#1643不关闭。
- 新增/优化：双端0.0.77，Mac build78，共同releaseSequence拟7701；新prerelease命名空间，不覆盖0.0.76或旧资产。默认stable，设置可选三层；21视频→166具名Home→明确云→其余普通DIRECT，Home/云匹配故障不降级。
- 工程与测试：同步四处Windows版本、Mac两个配置、候选guard/artifact/manifest与中英发布说明；不放宽任何ref、签名、固定DNS或特权准入。准确head CI/独立增量审查和原始检查结果另记。
- 验证：沿用#1571准确d029的[CI39025570441](https://github.com/raydocs/tono/actions/runs/39025570441)、[独立high](https://github.com/raydocs/tono/pull/1571#issuecomment-6232898332)与[最终日志/渲染核验](https://github.com/raydocs/tono/pull/1571#issuecomment-6233035109)，不是本版本准备提交的新结果。新增native旧代码Red、设备DNS/PF/WFP、第二跳Home身份/换云、升级回退、睡眠/换网、G0和一周试用未执行。
- 候选/发布：当前仅准备源码；拟由现有release线签名构建、Mac公证/DMG、Windows updater验签和provenance核验后分发手动RC。无生产Worker部署、R2镜像、Sparkle/windows-updates/v1 latest改动；G1–G3验收未代填。
- 剩余限制：普通DIRECT仅公网IPv4 TCP80/443；UDP/QUIC、IPv6、LAN及其他普通端口不支持，ECH/缓存裸IP/自带DoH隐藏AI可默认DIRECT。Mac限Apple芯片/macOS26.3+；Windows限x64 Win10 22H2/Win11，Authenticode实际结果待包检查。旧版先恢复网络退出再装；Windows0.0.32–34仍需正常卸载/重启，不绕过门禁。

### 准备提交本地验证
- Linux Orb：`python3 tooling/scripts/verify-desktop-version.py --expected 0.0.77` → 六处版本一致、PASS；`ruby tooling/scripts/tests/macos-candidate-workflow.test.rb` → 11分支案例、无效sequence/错误checkout/旧0.0.76包身份/权限与签名守护通过（synthetic unsigned fixtures）；`node --test tooling/scripts/tests/windows-ci-paths.test.cjs` → 14 passed/0 failed/0 skipped；`git diff --check` exit0。
- Red check：版本准备/保持行为不要求新增native Red；没有把签名fixture或旧编译失败记为设备/网络证明。当前未执行原生产品CI、签名/公证/下载，待准确提交和实际构建结果。

### 2026-10-17 · 准备合并与实际构建启动

- [准备 PR #1669](https://github.com/raydocs/tono/pull/1669) 已于12:22:35Z合并，冻结源码 [881240a0bb797d852d8b22cbffe657f532af203d](https://github.com/raydocs/tono/commit/881240a0bb797d852d8b22cbffe657f532af203d)；与独立审查准确head `d39978c15` 的tree完全相同，无新集成delta。`release/macos`、`release/windows` 已用 `git push --atomic` 从旧冻结源码无强推快进到同一SHA，远端读回一致。
- [准确head ci-gate39031585294](https://github.com/raydocs/tono/actions/runs/39031585294) success（23 jobs成功，sing_box/connect_bench按路径跳过）；[audit39031585280](https://github.com/raydocs/tono/actions/runs/39031585280) success。原始日志：Mac `Executed 735 tests, with 1 test skipped and 0 failures`；Windows Core `366 tests run: 366 passed, 0 skipped`；Service主套件 `581 passed; 0 failed`，App Rust主套件 `760 passed; 0 failed`。PR checkout85918ea是准确d399+base6ec54的merge，不冒称未签名CI包已具签名资格。
- [独立Codex high发布信任delta6233747515](https://github.com/raydocs/tono/pull/1669#issuecomment-6233747515) PASS，覆盖全部23文件并复用#1571准确覆盖，无Major+或有依据minor；GraphQL未解决threads为空、无CHANGES_REQUESTED。[最终验证6233827232](https://github.com/raydocs/tono/pull/1669#issuecomment-6233827232)列明Red/Ran/Not run；G1–G3/设备不据CI代验收。
- 实际启动 [Mac39032287500](https://github.com/raydocs/tono/actions/runs/39032287500)（`candidate_only=true`，0.0.77/build78）、[Windows39032289792](https://github.com/raydocs/tono/actions/runs/39032289792)（既有updater-signed draft流程），均冻结SHA同上、`update_release_sequence=7701`。签名/公证/实物身份/摘要/下载与Windows实际Authenticode状态待产物后续记，不沿用0.0.76结果。
- 保全基线：已读回0.0.76公开RC的全部资产id/size/digest；当前正式Mac首项0.0.67、Windows0.0.34、desktop/v1/latest HTTP404，保存只读前态以便发布后比对。未部署Worker或写正式源。

### 2026-10-17 · 首轮实际包核验拒绝；构建元数据定点修正

- [Mac39032287500](https://github.com/raydocs/tono/actions/runs/39032287500) hosted结论success，真实 `Executed 739 tests, with 1 test skipped and 0 failures`、Helper peer authorization、Developer ID、Apple公证Accepted、stapler/Gatekeeper和release gate均通过；**这不是独立包身份验收通过**。下载ZIP的SHA-256为 `cece060c365a63d7e3e99b33edc4b014b59bddc3da84aa298c8ce4ca902cc316`，包内版本0.0.77/build78/source881240a0/sequence7701，但 `tono-build-source.json` 的 `dirty=true`，独立校验断言失败，未分发、未建立RC、未dispatch DMG。
- 已核根因：冻结源码的tracked `CONTRACT.sha256`仍记录4.52.54/旧hash656632…，当前Helper为4.52.57，builder对同一25文件源码的实际hash为 `bec750d43b1a6ce8d65de6b8996691ee17e559a112909358f0b279cdc1c327bb`。独立计算该hash并与builder的 `--build-fingerprint`组合核对相等；builder写回tracked记录，准确stamp应当判dirty。CI helper在另一job生成并只传二进制，因此unsigned build的clean stamp不能覆盖这条发布路径。
- 本续修只同步该构建记录，并在发布helper构建后拒绝tracked contract diff、在候选manifest前校验sealed stamp的source/dirty=false/Release/sequence；不扩大build-source的helper例外，不伪造dirty=false，不改任何Helper行为、版本或特权合同。manifest补记准确releaseSequence，仍candidateOnly=true/releaseAccepted=false/sparkleSigned=false。
- Portable Red：只加回归、旧workflow的 `ruby tooling/scripts/tests/macos-candidate-workflow.test.rb` 实际exit1，断言 `candidate manifest accepted a dirty sealed source stamp`。修复后同文件通过（含干净包正例、dirty/错误source/错误sequence拒绝、旧版本拒绝）；`python3 apps/macos/scripts/test_build_source.py` 原2 tests OK；版本六处PASS，fingerprint及diff检查通过。都是synthetic/源码检查，不冒称新native包或设备证明。
- Windows首轮 [build-draft117396791676](https://github.com/raydocs/tono/actions/runs/39032289792/job/117396791676) 在资格/固定输入/Core通过后自12:32:01Z等待windows-release19923957922，尚未打包。旧Orb403凭据路径没有重试；复用的MacBook线程首个只读命令未返回，未证明代批完成、未提交新审批。已通知暂停旧881/7701审批；同一冻结SHA要求下，新修复合并后的双端构建须明确替代7701，拟共同序列7702，不重派同一旧SHA、不以旧Windows包冒充新包。没有windows-update-channel动作。
