# tono 交接：Grok Bot 全部交给 Claude Code（2026-10-01 03:45 MT）

main 当前在 `d985eaeb`。从现在开始，Claude Code 是 tono 唯一的总负责人：找 bug、修 bug、合并、出候选包都由你来做。Grok Bot 不再派新任务。

## 1. 硬规则（用户定的，必须遵守）

1. **tono 绝不能断网。**失败时回到普通网络，但 AI 继续拦；只有严格模式才允许全断。决策见 `docs/decisions/031-2026-09-30-fail-open-keeps-ai-block.md`。
2. **所有东西都进 GitHub。**每个修复都开 PR；不修的开 issue；报告放 `docs/agent-reports/`，也通过 PR 提交。不要把任何东西只留在本机。
3. **合并规则：**
   - `ci-gate` 变绿就合，只用 merge commit。UI PR 也一样，不再等用户审。
   - 改到网络或要真机验证的 PR，打上 `needs-hardware` 标签。
   - 修复 PR 写 `Fixes #N`。已经修好或过时的 PR 和 issue 直接关掉，留言写明修复它的 commit。
   - main 不要求分支和 main 同步，只要求 `ci-gate`。
   - 用户不想看到"看起来修好了却一直开着"的 PR 和 issue，要主动清理。
4. **helper 协议版本**永远是 main 的版本 +0.0.1；撞版本就变基再加 0.0.1。目前 main 的 helper 是 4.52.28，Windows 服务协议是 19。
5. **真机测试：**只放必须上真机的项，在 VM 或静杰的测试机上跑，第一步永远是备份。**绝不在用户的主力 Mac 上运行**任何会改 PF、DNS、路由、helper 或系统服务的命令，只做代码审查和单元测试。
6. **真机测试只在最后做一次**：从同一个 main 构建出包，按一份合并后的清单测，不要一个 PR 一个 PR 地测。
7. **开工前先看最新 main 和 open PR。**用户同时在用 Cursor、Codex 和 Claude Code，避免重复劳动。

## 2. 今晚做了什么（概要）

- 从 9/30 18:30 到现在合了大约 330 个 PR。main CI 一直是绿的。
- Codex 第 4 轮（账号 2）：开了 72 个 PR，合了 64 个；修掉两个 P1，分别是 #1084（DashScope 绕过拦截）和 #1106（Windows 断网保护死循环）。账号 2 这周用到 75%，要留 20%，不要再用。
- **内核：**macOS 早就是 sing-box alpha.9。今晚 Windows 也把默认内核切到了 sing-box alpha.9（#1140、#1196、#1159、#1175），mihomo 只做回退。回退条件是：本机明确选了 mihomo，或者 sing-box 二进制缺失或摘要不对，并且 WFP 还没武装。
- **性能**（对比 Clash，报告在 `docs/agent-reports/2026-10-01-perf-vs-clash.md`）：握手和 Clash 一样（44ms 对 43ms）。已经修掉三处：Windows gVisor 窗口（#1119，起步快约 15.7 倍）、备用 DoH 不再竞速（#1121）、`/delay` 探测推迟到隧道确认后 1.5 秒（#1122 是 Windows，#1126 是 macOS）。
- 覆盖图：`docs/agent-reports/` 里的 COVERAGE.md；Codex 状态和每组的发现见 #1209 和 `docs/agent-reports/codex-r4-resume.md`。

## 3. 你接手的工作

### A. 现在还开着的 PR（03:45 MT）
- **发布链路（你的区域，等你审）：**#1173（Windows release staging）、#1179（macOS signer）、#1185（release 上传的 glob）。另外有个未修的 P3：`tooling/scripts/upload-release-asset.mjs:96`。
- **Windows sing-box（你的区域）：**#1188（Service 只接受产品自带的 sing-box runtime，草稿，CLEAN），审完就合。新路径的重点审查项：回退 mihomo 的条件、WFP 已武装时不能换内核、协议 18 和 19 新旧版本混用、失败时不能断网。
- **#1193**（Windows 日志上传探测，草稿，CLEAN）：和遥测有关，看完 #724/#725 的结论再定。
- **有冲突要变基的：**#833、#795、#763、#352、#663、#691。先检查 main 是不是已经覆盖了它们的修复，覆盖了就关闭并写明 commit，没覆盖就变基修好。
- **有冲突的 docs PR：**#1053（真机测试总清单，很重要，变基后合并，并且要把今晚 Windows sing-box 这几个 PR 的真机项补进去）、#949、#936、#934、#920、#881、#877、#814。变基后合并，或者已经被替代就关闭。
- **不要动：**#203、#204（旧的迁移和 iOS 草稿）。#724、#725 是遥测，必须等用户拍板。

### B. 还没跑的扫描（原来排给 Codex，现在归你）
每组的完整提示词在 `docs/agent-reports/codex-r4-prompt-<slot>.md`：
- **RegLate / RegLate2：**复查 9/30 22:45 MT 之后合进去的所有 PR，找回归。
- **FixMisc：**#1134、#1125、#1131、#1132。
- **ExitAgent：**深扫 exit-agent、home-agent，以及它们调用的控制面接口。
- **FixNew：**午夜之后新开、还没人认领的 issue，比如 #1117、#1151、#1164、#1165、#1169、#1174、#1181、#1200。
- **WinSvcIPC：**Windows 服务的请求处理、desired/owner 状态、SCM 停止和关机路径。
- 另加一组：D1 数据库迁移的顺序和幂等性（还没人审过）。

### C. 等用户拍板（不要自己定）
- #724、#725：遥测默认开启。
- #1052：Mac 退出 App 后还拦不拦 AI。
- #1120：换账号重新登录时，AI 拦截会完全掉一下。
- #1145：公司 NRPT DNS 策略会盖掉 AI 域名拦截。
- #1051、#1139：Windows 的两个边缘情况。
- #1071：helper 升级时和旧 helper 怎么配合保持 AI 拦截。
- #901：macOS Keychain 写入失败后，会话卡在 `.error`。
- #829：重启后回收 198.18.0.2 会让 AI floor 掉掉。
- #1056、#1057 里的决策行。

### D. 出候选包（P0 和 P1 清完之后）
- **macOS 已签名候选：**先把 `stability/desktop-0.0.74-20260926` 快进到 main，然后运行
  `gh workflow run macos-release.yml --ref stability/desktop-0.0.74-20260926 -f version=0.0.74 -f candidate_only=true`。
  这一步不发 release、不打 tag、不改 appcast，用户已经同意。
- **Windows 候选：**在 main 上运行 `windows-candidate.yml`。不签名，也不发布任何东西。
- 两个包都交给静杰，按 #1053 的清单测。

### E. 已知缺口
- macOS 上选择性 AI 拦截的 hook 没有注册，所以 #963/#966 的 fail-open 会恢复全网但不拦 AI。helper 的 fail-open 和 #1048 是会拦的。
- ops-console 的 lint 和单元测试没进 CI。
- 需要真机的 issue：#331、#409、#422、#602。
- 产品层面：用户想把 tono 做成能上线的完整产品，要有产品介绍、官网和使用视频，并且持续优化速度，对标 Clash。两个运维后台（ops 1 和 ops 2）也要好用。

## 4. 不要做的事
- 不要在用户主力机上跑任何系统级网络命令。
- 不要合 #724/#725，也不要替用户做第 3C 节的产品决定。
- 不要发正式 release，不要改 appcast 或 tag。
- 不要用 Codex 账号 2。
