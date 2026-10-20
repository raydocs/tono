# iOS 状态权威第一轮 Devin Cloud 核对

- 验证源码：`a20b3c1074434a938d6c04da5b43b1f4c5ff3ad7`，`wip/ios-state-authority`；PR #1672。本报告不含自评分或新盲评结果。
- 会话：https://app.devin.ai/sessions/da2f266c910f4ca9a1abdd94c8641700 。关机后由所有者收回结果，根线程重新核对本地结果目录 `/Users/ruirui/.local/state/devin-cloud/runs/20261019-172122-wait-da2f266c9`。
- `summary.json` verdict=pass，exact commit 相同；根线程不只依赖此标签：核对各检查、原始日志、xcresult 摘要、附件存在性与摘要。
- 此结果支持把**同一提交**快进到 PR；不是合 main／发布批准。CI、冻结与新双盲评尚待后续记录。

## 根线程检查

- 请求的 7 个主检查 + S01–S14 共 21 项全部出现，均 report pass。
- `unit-tests.log` 有 110 条 XCTest passed case 行，0 failed/skipped case 行；末尾原文 `Executed 110 tests, with 0 failures (0 unexpected) in 0.607 (0.615) seconds`，EXIT=0。没有误读额外 Swift Testing 的零项 footer。
- `ui-tests.log` 有 35 条 passed case 行，逐个与源码 35 个方法名匹配，无缺失／多余方法；原文 `Executed 35 tests, with 0 failures (0 unexpected) in 961.109 (961.147) seconds`。xcresult 摘要独立列 passedTests=35、failedTests=0、skippedTests=0、totalTestCount=35。
- 三份构建日志均含 SUCCEEDED，0 个 error: 诊断；Release 使用真实缓存 Libbox，App／PacketTunnel／TonoWidgets 编译链接通过，unsigned，不包含 DEBUG preview 字符串。
- matrix-tests.log 有 24 个命名 filter 调用与 24 条 EXIT=0，覆盖 S01–S14；重复运行不与 110 单测相加。
- 32 个声明附件全部存在，两个 ZIP 完整性检查无损坏；预览 archive 100 个项目的 SHA-256 与 preview-manifest.txt 一致，单独关键 PNG 摘要也匹配。
- 28 条 audit waiver 原始记录保留；不能将 suite success 说成 Apple audit 未出现任何需豁免项。
- 六张截图的只读视觉抽查委派给 Opus 5.5/high，role=research、delegate_task async/shared，无产品修改；其受图片 hook 限制，实际上又交给 scout-haiku 打开，违反 brief 的不继续分派约束，已如实记录。返回的可见文字：Home 未确认无线路名；Details 三条 lanes 均 Not confirmed；拒绝切换 Home 仍称旧连接且提示 Couldn't switch；pending line 保留 Tokyo 并转圈；gallery 的 Routes stopped 卡有 Retry。图库其他 fixture 卡同时展示其他状态，不能当作同一系统状态的证明。没有独立评分。

## 证据边界／限制

- UI 测试使用 iPhone 17 / iOS 26.5；preview 脚本自动选择 iPhone 18 Pro / iOS 27.0。不能把这两组都写成 iOS 26.5，冻结采集须明确固定 runtime/device。
- zh-Hans 的 unconfirmed mode、rejected mode/put-back、pending line 没有当前脚本／启动参数产物；英文 UI 截图存在。缺图不算通过该语种的画面覆盖，冻结采集将记录／尝试通过已有交互补齐，不改产品或 rubric。
- Libbox tree SHA-256 `71a7a165a15459259b8563ab0cc9b18040b0a80eabbbd7f2e8f3a7d3ac45cc1f` 与缓存 provenance 相同，source/toolchain/pin 字段核对通过；该 manifest 来自快照维护时同一构建脚本自证，无独立签名 manifest，不提升为额外供应链信任证明。
- 上传视频已转码至 960p H.264；manifest 中原始 MP4 hash 对应 VM 原始文件，不直接当作上传转码文件 hash。下列附件摘要对本机收到的字节计算。
- xcresult 原始二进制可能包含模拟器标识元数据，不重发布进 git；无真实账号／服务访问。
- `acus_consumed` 结果为 0.0，如实记录 API 值，不推断免费。

## 检查项

| 项目 | passed / failed / skipped | 结果 |
|---|---|---|
| environment-and-pin | 1 / 0 / 0 | pass |
| full-unit-suite | 110 / 0 / 0 | pass |
| desktop-routing-sync | 1 / 0 / 0 | pass |
| unsigned-release-build | 1 / 0 / 0 | pass |
| simulator-debug-build | 2 / 0 / 0 | pass |
| full-ui-and-accessibility | 35 / 0 / 0 | pass |
| preview-evidence | 1 / 0 / 0 | pass |
| S01 | 1 / 0 / 0 | pass |
| S02 | 1 / 0 / 0 | pass |
| S03 | 1 / 0 / 0 | pass |
| S04 | 1 / 0 / 0 | pass |
| S05 | 2 / 0 / 0 | pass |
| S06 | 2 / 0 / 0 | pass |
| S07 | 2 / 0 / 0 | pass |
| S08 | 2 / 0 / 0 | pass |
| S09 | 3 / 0 / 0 | pass |
| S10 | 2 / 0 / 0 | pass |
| S11 | 1 / 0 / 0 | pass |
| S12 | 1 / 0 / 0 | pass |
| S13 | 2 / 0 / 0 | pass |
| S14 | 3 / 0 / 0 | pass |

## 已收回附件的摘要

附件留存在所有者私有 run directory，不把大型二进制重复提交；原始日志可由会话下载核对。

```text
caa6fbac35d21d63793a350d6aa1cff7d323fb3bcd9380144c80155d11acfd3e  Libbox.provenance.json
79f7bddd0315d12a7d0fd3cb961e0d04297808f86ad7a596be6ab21206bc2d77  details-mode-refused.png
cef0b339090f2b6be56c44d9234adbf38dd622b6e4af0e15276174e72311ee1e  details-mode-unconfirmed.png
8b144f9ed585b53510e8a97e79e771e2b55293c16fe08e771987212323246f42  details-unconfirmed.png
35b074595b608d7813f78d9977b2a869fb7cef95b494a0d71097551b5cf5e27c  device-build.log
ad5b83d4576b51dbb1f9173ae957aa27b98517bd5380c2f9e21cd2fa13fb4b60  en-04-connected.png
fe7d60e733871681f4712fa45b02cffbac1114c88548f5a67e5b4e910ce7757e  environment.log
bb7e643f8af6185c42a4f19a34e39aefa396731b7828b62146a6153903a8ef6f  home-line-pending.png
c341aa5f3d26f8f86a8ce0220c5c78ed97378e36de820d6c3d47d194b8791185  home-mode-refused.png
1a00c40efbc43032fd928985f15ed787044fdefcfb6cf68e3b32bc81223c0085  home-unconfirmed.png
e653c415826d0700f14bf9091fd42d789ade45aea98a6d6cff2d4381de0709c3  install.txt
f3472c243aa14c76ae740c9c95b25a36bf2b13ace61a6e15bd659d7e73dcf6e4  ios-preview-stills.zip
57292e23527c3fb24b836b29d0030c82eeb94717e3105641ee42e75130f84e09  matrix-tests.log
cd41a8e6315ad4cff0f94bb1cf8ad8ee1a2e435942fd8280bf9dc5c6713e6584  perf.txt
06eb23630e722d84b2a853b7cbc267bc96d1d9d409d89ff75a63d83ecab46a1e  preview-manifest.txt
10f1af66a33c828b0c39921d501c81c3c459db117e595491e771a12ff6ade698  preview-sheet-zoom.mp4
28b1ca85c948013de055366df19ca962dbcef53632b9cde8ff0cc2a464a6a12c  preview-state-cycle-en.mp4
7b615b6fba1c410adf96faab1c4a4d82201ea578cc28ef5a9b9796cb2e445e9e  preview-state-cycle-reduce-motion.mp4
034f3a003fc84585ca1005768b6abe45f22be5bf39e3ef9f7a89e86126a81b22  preview-state-cycle.mp4
ad4f3b8dde04f9503234bb989ce8d4070c0b343ae90f242b31338d7436ce7e1e  preview.log
954d377f1d2893da126b0e13f34770ae9187265678c289d5694d5264f21b5160  routing-sync.log
fcce560abb7591fd16ddaae0eef9d629bf7f5c6f5feba16d12184125bb5b9bd2  sim-build.log
93c21bd9e671a981dc6c61183a15e6f063a1b73087b7246cc56a38084ffe4414  test-build.log
6b6243a5e69b5921ec1554a90e98599e3e088f1ad70838a2bccd884203e9a833  ui-audit-lines.log
79c81a6e3ea8980bc903686a9ac8be83549ac4ac98e87e40111fb620f6289761  ui-tests-xcresult-summary.json
e77c99312dffef93967b4bf2145b85341a2fc336632cbc9c9591afb7045bab0c  ui-tests-xcresult-tests.json
bddc3f7b1822f175c095986e085002e5329d9d9777e4c687041d82b138cbb5ec  ui-tests.log
4f1dc468022dd68f5904b834358f7999a3d0a508fabe30e370f6142480c62ad6  ui-tests.mp4
a300403f46a87257c95a33fa95998e76df65f573b3a6155c390f35a825e1b904  ui-tests.xcresult.zip
f8f6c7087733035a6e508b2160771995017203cdbae278e45612c30734fa679d  unit-tests.log
2afa7f429a4a70482332caee64692ddd545fd8b6494f364b2e1b3d2f58ee524f  widget-routes-stopped.png
d8b532dabc3dddf429bdab78d32bd327465de95f1c7801cb534c1fc6635a0caa  zh-Hans-19-routes-stopped.png
```
