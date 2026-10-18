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

### 2026-10-17 · 干净源码修复合并；共同7702替代首轮

- [#1670](https://github.com/raydocs/tono/pull/1670) 准确head `af797a755262d6152def73233dd9a3f70c5432a3` 的 [CI39034176737](https://github.com/raydocs/tono/actions/runs/39034176737) 全部结束：17success、3按路径skipped（Windows、sing_box、connect_bench）；实际Mac `Executed 735 tests, with 1 test skipped and 0 failures`，unsigned build的Helper重建后clean stamp守护通过。原始checkout `3bac853` 是af797+base881的merge。Windows本轮未重新执行，不把路径skip当通过。
- [独立Codex high6234105043](https://github.com/raydocs/tono/pull/1670#issuecomment-6234105043)完整覆盖4文件43+/2−及builder/stamp/package链，无Major+或有依据minor，复用#1669/#1571；独立重算25文件hash及recipe fingerprint与record一致。GraphQL未解决threads为空、无CHANGES_REQUESTED；云Codex的failed摘要对应usage limit，不是代码finding。[最终回执6234185583](https://github.com/raydocs/tono/pull/1670#issuecomment-6234185583)列明Red/Ran/Not run。
- PR于13:01:19Z合入 [647cf2633956e6bd9f6eda7af51cab7a1cdbed57](https://github.com/raydocs/tono/commit/647cf2633956e6bd9f6eda7af51cab7a1cdbed57)，tree与af797完全相同，无新集成delta；两个release ref再以atomic无强推快进到同一SHA，远端读回一致。旧Windows39032289792取消并读回completed/cancelled，未安装包构建、未批准、未发布。
- 各启动一次新 [Mac39034869643](https://github.com/raydocs/tono/actions/runs/39034869643) 与 [Windows39034871681](https://github.com/raydocs/tono/actions/runs/39034871681)，准确冻结SHA同上，版本0.0.77/Mac78/共同sequence7702，明确替代未发布的881/7701，不是重派旧SHA。实际签名、公证、sealed身份、包摘要和下载仍须后续验收；正式feeds、0.0.76与所有旧资产不变。

### 2026-10-17 · Windows候选审批读回（decision023记账）

- [新run39034871681](https://github.com/raydocs/tono/actions/runs/39034871681) 的安装器job117403989413自13:09:00Z等待唯一`windows-release`/19923957922，资格4项、branch、sing-box与pinned-core均成功。候选准确SHA为647cf2633956e6bd9f6eda7af51cab7a1cdbed57，version0.0.77，sequence7702。
- 13:14Z独立API读回`approvals=[approved/raydocs/comment=""/windows-release]`、`pending_deployments=[]`；job自13:11:04Z实际in_progress，版本/签名配置、key-pair验签及固定输入准备通过，Service编译开始。账户审计不能区分具体会话，不冒称本Orb代批；本Orb没有审批POST、没有重试已知403路径，MacBook未返回的工具也没有被冒称成功。已通知不要重复审批；没有`windows-update-channel`动作。实际安装包与签名验收仍待构建完成。

### 2026-10-17 · Mac7702实际ZIP和DMG核验通过

- [Mac39034869643](https://github.com/raydocs/tono/actions/runs/39034869643) success，原始 `Executed 739 tests, with 1 test skipped and 0 failures`；Helper peer authorization、Developer ID签名、公证Accepted（id `9385a0a8-4b6b-4d86-913f-7b28a314e868`）、装订、Gatekeeper `source=Notarized Developer ID` 和`release gate passed`均通过。候选不持Sparkle签名权限，`candidateOnly=true/releaseAccepted=false/sparkleSigned=false`。
- 下载ZIP **19009040 bytes**、SHA-256 **`d69b6edb646def6f308f156b17932562131747fac64c4f5f45760bea93540017`**。Linux独立解读实际Info.plist及sealed stamp，确认0.0.77/build78、`com.raydocs.tono`、arm64/macOS26.3+/internal、准确冻结647cf263/`dirty=false`/Release/7702；CRC、唯一Tono.app根及App/Helper/Core全部摘要与manifest匹配。不把包核验称设备验收。
- 只用上述已验ZIP启动 [signed DMG39036488825](https://github.com/raydocs/tono/actions/runs/39036488825)，success；App不重编，挂载逐文件证明与ZIP一致（20 paths），Developer ID/公证Accepted（id `af633081-f75d-4e91-b890-12641bb10b98`）/装订/Gatekeeper均通过。下载DMG **21267998 bytes**、SHA-256 **`1f267ce83898d75853f9805181581c0bf930cdb429c2ec4ccf9f8eefe3cab224`**，与hosted原始checksum相同；直接`sha256sum --check`先因回执含host绝对路径不可读而失败，按basename定位同名下载文件后完整digest比较通过，未修改原回执或放宽摘要比较。
- ZIP、DMG分别执行`gh attestation verify`，固定对应`macos-release.yml`/`macos-dmg.yml`、`refs/heads/release/macos`、source digest647cf2633956e6bd9f6eda7af51cab7a1cdbed57及`--deny-self-hosted-runners --format json`，均exit0；证书来源为github-hosted，subject摘要与实物一致。尚待Windows产出后同一新RC公开分发及匿名下载核对，不提前把本地包核验称已公开交付。

### 2026-10-17 · 双端7702实际发布与匿名下载通过（非稳定验收）

- [Windows39034871681](https://github.com/raydocs/tono/actions/runs/39034871681) completed/success，全部10 jobs成功；实际安装器job13:11:04Z至13:40:48Z（29m44s），真实NSIS预检25 entries、Core/Service digest pins、静态CRT及固定输入守护通过。原始构建环境`TONO_UPDATE_RELEASE_SEQUENCE: 7702`、版本0.0.77、准确source647cf263已核；没有冒称Service有独立可读source stamp或已安装runtime floor观测。
- [Windows EXE](https://github.com/raydocs/tono/releases/download/tono-desktop-0.0.77-rc.20261017.1/Tono_0.0.77_x64-setup.exe) **41240457 bytes**，SHA-256 **`f1f517854230164fb4d658e0215b6e7ed4a36cb267068110790aaa49e69ff104`**；[`.sig`](https://github.com/raydocs/tono/releases/download/tono-desktop-0.0.77-rc.20261017.1/Tono_0.0.77_x64-setup.exe.sig) **436 bytes**，SHA-256 `440c118773a48d9fea5c131e451f5974d05d75eeb888576d697d6f8b261e5c42`。完整EXE用现有`verifyUpdaterSignature`和此前公开配置回执中固定的Tono公钥验签通过，翻转4096 byte的篡改副本被拒绝；不是新生成公钥、不是新的变量GET。原始draft manifest的版本、两个平台URL/签名与实际产物相符。
- EXE及`.sig`各以`gh attestation verify`固定`windows-release.yml`、`refs/heads/release/windows`、同一source digest647cf263及`--deny-self-hosted-runners --format json`通过。**没有Authenticode发布者签名**：实际PE certificate directory offset/size均0；updater签名不保证SmartScreen或企业发布者策略放行，需要该类证书的客户机器暂不适用，不关闭系统安全策略绕过。
- 新公开 [tono-desktop-0.0.77-rc.20261017.1](https://github.com/raydocs/tono/releases/tag/tono-desktop-0.0.77-rc.20261017.1) 已创建，非draft、prerelease、非latest，tag读回准确冻结647cf2633956e6bd9f6eda7af51cab7a1cdbed57，双端共同7702。上传全部新资产，无`--clobber`；[Mac DMG](https://github.com/raydocs/tono/releases/download/tono-desktop-0.0.77-rc.20261017.1/Tono-0.0.77-build78-arm64.dmg)、[ZIP](https://github.com/raydocs/tono/releases/download/tono-desktop-0.0.77-rc.20261017.1/Tono-0.0.77-build78-arm64.zip)、[SHA256SUMS](https://github.com/raydocs/tono/releases/download/tono-desktop-0.0.77-rc.20261017.1/SHA256SUMS.txt)及实物身份、四份provenance、公证、原生预检回执齐备。原始Windows `v0.0.77`仍draft，不转正或推广自动频道。
- 无认证头`curl -fLsS`公开下载ZIP/DMG/EXE/`.sig`分别**HTTP200 / 19009040、21267998、41240457、436 bytes**，四份SHA-256全部匹配已验产物与GitHub asset digest；公开SHA256SUMS也与本地已验清单相同。[下载回执](https://github.com/raydocs/tono/releases/download/tono-desktop-0.0.77-rc.20261017.1/anonymous-download-verified.json)已附，仅证明Orb下载，不等于国内三网或设备资格。
- 保全读回：0.0.76全部16个旧资产id/name/size/digest完全相同；正式appcast与Windows feed前后bytes完全相同，首项仍0.0.67/0.0.34，desktop/v1/latest仍HTTP404，GitHub stable latest仍v0.0.72。没有R2镜像、Worker部署、正式feed写入或windows-update-channel审批。
- 交付边界：可发客户做**手动测试候选**，不标稳定版或全量自动更新。旧App先恢复正常网络并退出后安装；Windows0.0.32–34正常卸载/重启再装，不强删保护或覆盖降级。默认Stable，三层需显式选择并断开/重连；普通DIRECT仍限公网IPv4 TCP80/443，UDP/QUIC/IPv6/LAN不支持，隐藏AI可默认DIRECT。设备PF/WFP/DNS、Home第二跳/跨云、旧客升级回退、睡眠换网、G0/固定候选试用及G1–G3未验收；#1071/#1504/#1605/#1643保持独立，具体P0/P1清单和操作在release正文。
