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
