## 2026-09-26 · desktop 更新签名 workflow：只签名、不能发布（G3 测试包前置 PR-6）
- 归属：G3（SHIP_PLAN 一轮验收测试包的前置 PR-6，计划 v2 §2.3，含审查意见 m8「签名输入绑定不足」）；
  影响 `.github/workflows/desktop-update-sign.yml`（新）、`services-ci.yml` 路径过滤、
  `tooling/scripts/tests/desktop-update-sign-workflow.test.mjs`（新）、`docs/UPDATE_INTEGRATION_V1.md`。
- 来源：基线 origin/main `184b1a0c`；红分支 `wip/desktop-update-sign-20260926-red`（`4a625f71`，只有结构测试）；
  分支 `feat/desktop-update-sign-20260926`，[#661](https://github.com/raydocs/tono/pull/661)；未合 main。
- 缺陷修复：无。
- 新增/优化：新 workflow 只能手动派发，只在 `release/windows` 上跑（不带条件的 guard，其余 job 都依赖它），
  令牌只有 `contents: read`、`actions: read`。输入为两个 producer run id、源码 SHA、序列号、版本、渠道（只允许 release）；
  `release_id` 由 `tono-<版本>-s<序列>-<SHA8>` 推出。签名前逐项绑定（m8）：run 的 workflow 文件、`workflow_dispatch`、
  `release/macos` / `release/windows`、head SHA、成功；构建 job 日志里的 `TONO_UPDATE_RELEASE_SEQUENCE`、Windows `RELEASE_VERSION`、
  `TONO_BUILD_CHANNEL` 为空；按 artifact id 下载并核对 digest，包内文件名精确匹配；macOS 核对 receipt、封存的
  `tono-build-source.json`（commit、releaseSequence）、Info.plist（版本、build、`TonoBuildChannel` 为空、`SUPublicEDKey`）、
  Helper 内置公钥、codesign/stapler/spctl 和 release gate；Windows 核对安装包 Tauri 签名、安装包与 `Tono.exe` 的 ProductVersion、
  `tono-service.exe` 内编译的下限和更新公钥。然后 measure、assemble，Sparkle 私钥只在 `macos-appcast` 环境 job 的一个 step 里经 stdin 使用，
  Tauri 私钥只在 `windows-release` 环境 job 的一个 step 里经 env 使用；bundle 用固定公钥验两份签名和两个包的摘要后，
  才上传保留 30 天的 workflow artifact（含 `signing-record.json`）。没有 release、tag、R2、feed、promote、push 或 API 写入步骤；
  上传到 `desktop/v1/` 仍是 workflow 之外、需 owner 授权的单独一步。
- 工程与测试：结构测试 5 项（只能派发、只读令牌、guard 不可跳过且所有 job 依赖、每个私钥只在自己环境 job 的一个 step env、
  没有发布/上传/推广/推送/API 写入且 action 限定并钉到 commit）；借用 ops-console lockfile 里的 js-yaml。
  `services-ci.yml` 把新 workflow 加进 push/pull_request 路径，改它就会跑这项测试。
- 验证：红分支 services-ci run 36229534164：`ops-contract` 失败，新增 5 项因 ENOENT 失败，其余 80 项通过。
  本机 `node --test` 新测试 5/5 通过；五个单行变异（写权限、`if: always()`、私钥进别的 job、`gh release`、guard 分支）各自使对应测试失败。
  guard 的 run/日志/artifact 函数用只读 API 对真实 run 36212061109（macOS 候选）和 35279328253（Windows 正式）实跑：
  匹配时通过，分支、workflow、SHA、序列、版本、渠道（`internal`）、缺 job、缺或外来 artifact 都拒绝。macOS 包检查对 fb5e8485 候选包实跑
  （无序列，拒绝）及其改写副本（通过）；Sparkle 验签 step 用生成的密钥通过、用生产公钥拒绝且不写输出。
  绿以 #661 头部的 services-ci 为准。未执行：新 workflow 本身、codesign/stapler/spctl/7z/ProductVersion、Linux 上的 `tauri signer sign`、
  `sign_update` 的 stdin 模式。
- 候选/发布：仅源码，无新候选；新 workflow 未派发，未签名任何东西。
- 剩余限制：macOS gate 步骤调用本次 checkout 的 `verify-release-gate.sh`，main 上它仍检查 `mihomo`，前置 PR-4 合入前签名 run 会在 gate 失败（失败即关闭）。
  producer artifact 保留 7 天，签名须在构建后 7 天内完成。Windows 下限是 `tono-service.exe` 里的子串匹配，
  更强的记录是构建 job 的 env 行和已签名清单里的序列号。
- **续记（2026-09-26，合并回归审查 6e71164d 的 major 及真实 7401 安装包核对）**：#661 已合 main（`20278e72`）。
  ① CR6e71-sign-nsis-copies：windows-verify 按名字递归找组件并要求只有一份，#658 之后的安装包还带 `$PLUGINSDIR/tono-gate/resources/`
  预安装门副本，签名会拒绝每个真实安装包。现在由新脚本 `tooling/scripts/windows-package-components.mjs` 按安装路径取
  `Tono.exe.next`、`tono-core.exe.next`、`resources/tono-service.exe`，包里其它同名组件副本（含所有 `tono-service*.exe`）必须逐字节相同，
  否则拒绝。② SIGN-WIN-FLOOR-STRING：真实包里没有序列号字符串（编译期折成整数），删去该子串检查，序列号只由 guard 核对构建 job env。
  测试：`tooling/scripts/tests/windows-package-components.test.mjs`（按真实布局造双份目录：取安装副本；门副本改一字节即拒绝）；
  红分支 `wip/desktop-update-sign-nsis-copies-20260926-red`（`07d3c069`，仅测试，模块不存在）。本机对真实 7401 解包实跑：
  取 `resources/tono-service.exe`；改门副本一字节即拒绝。services-ci 路径加入新脚本。分支 `fix/desktop-update-sign-nsis-copies-20260926`，[#665](https://github.com/raydocs/tono/pull/665)。
  新 workflow 仍未派发。`windows-candidate.yml` 配对候选的测量步骤有同样的按名查找，未在此修改。
