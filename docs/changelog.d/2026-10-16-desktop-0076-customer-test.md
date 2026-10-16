## 2026-10-16 · 0.0.76 双端客户测试候选准备

- 归属：SHIP_PLAN G1–G3 测试候选；所有者最新授权「直接升级，升级最新的我给客户测试」。不是稳定验收或 G4 正式更新源推进。
- 来源：安全主线 [71d33e8](https://github.com/raydocs/tono/commit/71d33e8f80bc265c3ffb45d25754370bc9e2f0c3)；分支 `release/desktop-0.0.76-test-20261016`。最终构建源码、run、哈希和签名结果在实际产生后续记。
- 缺陷修复：无新运行时改动；已有 #1569/#1591/#1599/#1646/#1648/#1659 等主线成果进入新候选，不重复计为本 PR 修复。#1504/#1605/#1643/#1571/#1572 不合入。
- 新增/优化：双端营销版本 0.0.76，Mac build77；新候选命名空间，不覆盖 0.0.75 等已有资产。两端拟用相同 releaseSequence 7601，签名/公证使用既有受控流程。
- 工程与测试：同步 Windows 四处版本（通过既有 release-version 脚本）、Mac 两个配置、候选 workflow/artifact/manifest 守护和中英发布说明。分支、密钥、权限、签名门禁不放宽；正式 feeds 和 v1 latest 不动。
- 验证：Linux Orb 定点检查通过：`verify-desktop-version.py --expected 0.0.76`（source consistency only）、`macos-candidate-workflow.test.rb`（11 个分支案例、无效序列/错误源码/旧包/权限守护，synthetic unsigned fixtures）、`node --test tooling/scripts/tests/windows-ci-paths.test.cjs`（14 pass / 0 fail）、`git diff --check`。准确 head 的 ci-gate、真正构建/签名/公证与产物核验另记，尚未执行者不计通过。无新行为回归，不伪造红检查。
- 候选/发布：本提交仅准备源码；客户测试包待 hosted 构建。以新 prerelease 分发手动安装包，不把 GitHub prerelease 称为稳定客户频道。
- 升级边界：先在旧客户端恢复网络并退出，再手动覆盖；Windows 0.0.32–0.0.34 的 legacy 文件名风险仍按既有方案先正常卸载、重启再装，未实机复现，不承诺直接覆盖。其它旧版本覆盖与 G3 成功/故障待用户实测。
- 剩余限制：#1071 未修；#1605 的 DNS fallback 与 #1643 多用户接管未包含；Windows 现有 updater 签名不等于 Authenticode；没有新的真机验收、稳定发布或全量更新源授权。

### 2026-10-16 · 冻结与实际构建启动

- [准备 PR #1666](https://github.com/raydocs/tono/pull/1666) 已合并；冻结源码 [6ef22dcf01c11406d52e87f3948a63a2d80ddb9c](https://github.com/raydocs/tono/commit/6ef22dcf01c11406d52e87f3948a63a2d80ddb9c)。它与审查 head `664c5e34f` 的 tree 相同；两条 release 分支已用 `git push --atomic` 无强推快进到该 SHA，并读回一致。
- 验证：准确 PR head 的 [ci-gate 38964702298](https://github.com/raydocs/tono/actions/runs/38964702298) success，Mac/Windows/服务及四个 E2E job 成功，独立 sing_box/connect_bench 按路径 skipped；Dependency audit 38964702324 success。[独立 high 审查](https://github.com/raydocs/tono/pull/1666#issuecomment-6224458137) PASS，major+ 0/minor 0；[验证评论](https://github.com/raydocs/tono/pull/1666#issuecomment-6224591502) 区分 PR checkout、未执行的签名/真机门。
- 构建：双端版本 0.0.76、Mac build77、`update_release_sequence=7601`；[Mac run38966270822](https://github.com/raydocs/tono/actions/runs/38966270822) 使用 `candidate_only=true`，[Windows run38966275119](https://github.com/raydocs/tono/actions/runs/38966275119) 使用现有签名发布流程。两端资格检查及 ref/sequence 门通过；Mac 正在实际 App 构建，Windows 固定 Core 输入已完成。
- 环境审批（decision023）：2026-10-16 ~21:09Z 对上述 Windows run 的 `windows-release`（environment id19923957922、源码同上、序列7601）实际尝试自批准；POST `pending_deployments` 被当前 GitHub integration 凭据拒绝 **HTTP403**。未批准、未绕过；读回 `build-draft=waiting`。需有权限的仓库用户在该 run 批准这一个 environment；不批准 `windows-update-channel`。这不证明签名密钥缺失，也不是 Windows 编译失败。

### 2026-10-16 · Mac 实物交付；Windows 签名构建待授权人员审批

- 全新测试 prerelease：[tono-desktop-0.0.76-rc.20261016.1](https://github.com/raydocs/tono/releases/tag/tono-desktop-0.0.76-rc.20261016.1)，非 draft、`prerelease=true`、非 latest。tag 读回与上述冻结源码完全相同。没有复用旧 draft、覆盖任何已有资产、上传正式 R2 镜像或推进客户源；Windows 目前没有0.0.76安装包，不用旧版冒充。

| Mac 0.0.76/build77 产物 | bytes | SHA-256 |
| --- | ---: | --- |
| [DMG（推荐）](https://github.com/raydocs/tono/releases/download/tono-desktop-0.0.76-rc.20261016.1/Tono-0.0.76-build77-arm64.dmg) | 21205476 | `9d3cd9bfc94b29c72a0b20c60d1cc01aad7a3c546df111cf7b8803c809e3bd83` |
| [ZIP](https://github.com/raydocs/tono/releases/download/tono-desktop-0.0.76-rc.20261016.1/Tono-0.0.76-build77-arm64.zip) | 18947032 | `67682881e13eafa9bdc3e1ca9999228652576053f8940a2852e9a86db5981a6f` |

- Mac 原生证据：run38966270822 success；XCTest 原始输出 `Executed 734 tests, with 1 test skipped and 0 failures`；Helper peer authorization、Developer ID 签名、公证装订、Gatekeeper `source=Notarized Developer ID`、`release gate passed`。候选 manifest 明确 `candidateOnly=true/releaseAccepted=false/sparkleSigned=false`。
- 包内实物：Linux Orb 检查 ZIP CRC、唯一顶层 `Tono.app`、0.0.76/build77、bundle id、macOS26.3下限、internal channel、stamp（准确冻结源码，`dirty=false/configuration=Release/releaseSequence=7601`）与全部四个包/组件摘要，均 PASS。App `a3bf5bdb…`、Helper `4345eb7a…`、Core `85a09c12…`；完整值在 release 附件 `candidate-manifest.json`。
- DMG：[run38968875885](https://github.com/raydocs/tono/actions/runs/38968875885) success；App 不重编，挂载后逐文件比对 `matches … zip (20 paths)`；Developer ID 签名、公证、装订、Gatekeeper 均通过。公证 id `eb441d78-e546-4495-9fbd-301fa474601e`、status Accepted，回执在 release 附件。
- Provenance：ZIP 和 DMG 分别执行 `gh attestation verify <file> -R raydocs/tono --signer-workflow <对应 macos-release.yml / macos-dmg.yml> --source-ref refs/heads/release/macos --source-digest 6ef22dcf01c11406d52e87f3948a63a2d80ddb9c --deny-self-hosted-runners --format json`，exit0；核验结果附在 release。它证明构建来源，不替代 Apple 签名/真机验收。
- 下载验证：无 GitHub 认证头的 `curl -fLsS <各下载URL>`，ZIP **HTTP200 / 18947032 bytes**、DMG **HTTP200 / 21205476 bytes**；下载后 `sha256sum --check --strict` 两者均 OK。仅证明从 Orb 的公开下载，不冒称国内三网可达性。
- 客户测试与升级：release 正文有完整手动步骤及 P0/P1 清单。Mac 先在旧 App 断开/恢复网络，确认普通上网再退出，核摘要后用 DMG/ZIP 替换 Applications；不强删 Helper 或覆盖降级。Windows 0.0.32–0.0.34 按前述正常卸载/重启/安装限制，签名包尚待审批产出。真机升级、PF/WFP、G1/G2/G3及睡眠唤醒 **未执行**；用户「测试无问题」未被改写成特定包/SHA/设备验收。
- 源保持：公开 Sparkle最新项0.0.67、Windows0.0.34；`desktop/v1/latest/manifest.json` HTTP404。没有全量自动更新或稳定发布。Mac候选 internal channel 与无Sparkle签名的边界保留；不据此承诺可直接做稳定频道推广。

### 调查续记：仍需处理的 PR / Issue 与测试优先级

- 对照发布基线：GitHub latest 仍是 [Windows v0.0.72](https://github.com/raydocs/tono/releases/tag/v0.0.72)，Mac最近非prerelease为 [0.0.72/build72](https://github.com/raydocs/tono/releases/tag/tono-macos-0.0.72-build72)；0.0.73 RC是旧测试包，Windows0.0.74/0.0.75仍draft，不能当已发客户版。公开tag至冻结main分别为 `git rev-list --left-right --count` 的 `0 / 4904` 和 `0 / 4896`，均为祖先；全库差异分别4936/4933文件，含文档、合并历史与资源，不是4904个缺陷修复。相比公开包已有大量保护/恢复/身份与工具链变化，不能只凭一次CI声称全量升级安全；更新feed版本与GitHub latest也不是同一事实。
- 已安全合并：[Windows验证/工具链 #1664](https://github.com/raydocs/tono/pull/1664)（合后 Windows CI [38961779603](https://github.com/raydocs/tono/actions/runs/38961779603) 全成功）、上述候选准备 #1666。其余5个 open PR保留：[非Draft但暂停的 #1504](https://github.com/raydocs/tono/pull/1504) 仍缺当前 head 放行/设计决定；[#1605](https://github.com/raydocs/tono/pull/1605) Draft，旧 major 已有续修但不能冒称当前覆盖通过；[#1643](https://github.com/raydocs/tono/pull/1643) Draft/HOLD；[#1571](https://github.com/raydocs/tono/pull/1571)/[#1572](https://github.com/raydocs/tono/pull/1572) 明确下一阶段，后者已有 Mac policy 失败不强合。未把旧 review 的失败冒充最新代码已证实的缺陷。
- **P0，稳定/自动升级前不能冒称已过：** [#1071](https://github.com/raydocs/tono/issues/1071#issuecomment-6104954405) 的无故障 abandoned-upgrade 清理仍完整 disarm，修复归属 #1504；源码/注入 I/O 证据不是真机 PF/AI hold 证明。G1连通与Activity、G2失败恢复、G3已装双端升级及更新日记成功/故障路径必须绑定同一候选。手动覆盖成功不等于受保护自动升级成功。
- **P0，Windows实机保护回归：** [#257评论](https://github.com/raydocs/tono/issues/257#issuecomment-6142123584) 要求新 sing-tun 的 IPv6 router solicitation（ff02::2）在 WFP fail-closed 下验收；覆盖 Win10/11、有线/Wi-Fi、连接/断开、DHCP续租/换网与恢复后两分钟不复锁。Rust/Core/签名工具更新 #1635/#1637/#1638 已合，剩下 Mac Studio 的 Tailscale和本地工具用 mihomo资源重编未做，不把旧二进制的工具链项冒称完成。
- **已修复部分待实机，不关闭整个Issue：** [#1280](https://github.com/raydocs/tono/issues/1280) 的 sing-box新文档/替换绑定已随 [#1646](https://github.com/raydocs/tono/pull/1646) 合入，需 Windows实际 DIRECT替换/签名策略拉取；mihomo绑定、watchdog重放、进程授权粒度和策略replay的记录限制仍在。不能把所有DIRECT授权问题称已修复。
- **P1，特殊身份场景/所有者输入：** [#409](https://github.com/raydocs/tono/issues/409#issuecomment-6142326541) 的 Mac硬件anchor与Windows本机凭据已部分修复，Mac data-protection Keychain仍需有授权entitlements的Developer ID provisioning profile、打包改动授权和迁移策略；跨Mac迁移/Windows roaming profile需要第二台真机，不在本轮擅改签名链。
- **可延后硬化但需专门设备测试：** [#602](https://github.com/raydocs/tono/issues/602#issuecomment-6142302530) 只剩 DHCPv4 service-SID permit 项，当前没有真机旁路复现；不能不测就收紧而断租。设备矩阵/ETW捕获/首次DISCOVER/renew/release/重启/换网/非Dhcp进程否定对照在该评论。其余跟踪项已修，不把推测升级为泄漏事实。[#1293](https://github.com/raydocs/tono/issues/1293) 是读码推导的 P3 多用户/更新汇总，需逐项映射已合修复、设计和真机，尤其 #1643 HOLD 不强合。
- **非桌面客户候选阻塞：** [#1665](https://github.com/raydocs/tono/issues/1665) 的截图 nightly 失败之后同源码两次成功：[38642992873](https://github.com/raydocs/tono/actions/runs/38642992873)、[38810450892](https://github.com/raydocs/tono/actions/runs/38810450892)，不是0.0.76真机证明，也未擅自关闭Issue。[#210](https://github.com/raydocs/tono/issues/210) 是未完成的 iOS Apple SDK/签名/路由/设备资格；关联 #204 当前 CLOSED且未合，并非遗漏的open Draft，不进入Mac/Windows候选。
- 结论：可以交付 **明确标注的手动客户测试候选**（Mac已实际交付）；尚不能称双端稳定版或老客全量自动升级已完成。Windows剩余最小动作是上述一次有权限的environment审批，之后仍要完成真实签名构建和实物核验，不承诺必然成功。

### 2026-10-16 · Windows 审批阻塞解除（decision023 记账）

- 用户确认已亲自批准；run38966275119、`windows-release`/19923957922、准确源码同上、sequence7601。GitHub `/approvals` 读回 `approved / raydocs / comment=""`，`pending_deployments=[]`；deployment7129531321 的状态为 waiting21:08:03Z → queued21:33:24Z → in_progress21:33:26Z。账户审计本身不区分具体用户会话，用户亲自操作来自用户反馈，不冒称代理代批成功。
- Orb 只有前述被拒绝的 integration 身份；MacBook 则找到现有有权的 gh keyring 身份，但提交前 guard 已发现审批并发完成，**ZERO审批POST**，未重复403、未改变认证配置或工作树。[MacBook只读核验证据](https://github.com/raydocs/tono/pull/1667#issuecomment-6225137619)。没有 `windows-update-channel` 审批。
- 构建读回 `build-draft=in_progress`，版本/配置守护、签名key-pair校验、固定输入准备均通过；Windows最终安装包、实物签名验证和下载尚待构建完成，不将审批通过计为安装包通过。已有历史403和pending记录保留。

### 2026-10-16 · 双端测试候选已实际可下载；非稳定验收

- [Windows run38966275119](https://github.com/raydocs/tono/actions/runs/38966275119) **success**，全部10 jobs成功；实际 `build-draft` 31m15s，NSIS实物检查25 entries、Core/Service digest pins、静态CRT和打包守护均通过，随后 attest/publish-draft 成功。版本0.0.76、准确源码同上，构建环境序列7601；没有触发重建或改动发布门。
- [Windows x64 EXE](https://github.com/raydocs/tono/releases/download/tono-desktop-0.0.76-rc.20261016.1/Tono_0.0.76_x64-setup.exe)：**41152075 bytes**，SHA-256 **`00b3cfbc6398b5548c9eb5cb3fa27417ea915ae8e91f66eaac00043237b84643`**。[Tauri .sig](https://github.com/raydocs/tono/releases/download/tono-desktop-0.0.76-rc.20261016.1/Tono_0.0.76_x64-setup.exe.sig)：436 bytes，SHA-256 `dc6066d0e9ff95daa60b70918c68e71f0ef3a217f5715190ccb676b2c0edf734`。
- 独立实物验证：以只读取得的仓库配置公钥运行现有 `verifyUpdaterSignature`，完整EXE签名通过，翻转第4096 byte的否定对照被拒绝；版本及原始manifest两个平台的signature/URL一致。EXE与`.sig`各执行 `gh attestation verify`，固定 `windows-release.yml`、`refs/heads/release/windows`、上述源码digest及 `--deny-self-hosted-runners`，均exit0；证明构建来源而非真机行为。
- **没有 Authenticode 发布者签名**：实际 PE certificate directory offset/size 均0；Tauri验签不代表SmartScreen或企业发布者策略放行。需该类证书的客户机器不适用这个候选，不关闭系统安全策略绕过。
- 仅向新测试prerelease追加8个全新Windows资产（EXE、`.sig`、[校验和](https://github.com/raydocs/tono/releases/download/tono-desktop-0.0.76-rc.20261016.1/WINDOWS-SHA256SUMS.txt)、候选manifest、NSIS输出、验签与两个provenance结果），未用`--clobber`，Mac既有资产digest读回不变。原始 `v0.0.76` 新构建draft及其latest.json仍保留为draft，不转正、不发布到自动源。新增manifest明确 `candidateOnly=true/releaseAccepted=false/deviceUpgradeTested=false/authenticodeSigned=false`，Windows序列证据为构建环境，不冒称设备runtime观测。
- 对公开EXE/`.sig`执行无认证头的 `curl -fLsS`：分别 **HTTP200/41152075 bytes**、**HTTP200/436 bytes**；对下载副本 `sha256sum --check --strict` 两者OK，且与hosted预检/GitHub资产digest一致。双端release仍为prerelease、非draft、非latest，tag源码不变；GitHub stable latest仍v0.0.72。
- 正式源最后读回：`https://api.afk.ccwu.cc/appcast.xml` 首项0.0.67，Windows官方latest.json为0.0.34，客户端DISCOVERY_URL的 `https://releases.afk.ccwu.cc/desktop/v1/latest/manifest.json` HTTP404。没有正式R2镜像、update-channel审批、Worker部署或全量推广。
- **最终交付边界：** 两端手动客户测试包已交付，无构建/签名审批阻塞；Mac限Apple芯片/macOS26.3+，Windows限x64 Win10 22H2/Win11。升级步骤、Windows0.0.32–34正常卸载/重启限制、P0/P1和已知风险都在release正文；Windows保留旧日志偏好，全新安装默认上传流量日志（设置可调），并非本轮改动。真机旧客升级、PF/WFP、G1/G2/G3、睡眠唤醒仍**未执行**，不关闭上述Issue，不宣布稳定验收。
