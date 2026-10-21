# 2026-10-18 Android #1673 第 6 轮：两份独立盲审与密封自评并列

固定基线：head [`bf449391`](https://github.com/raydocs/tono/commit/bf449391feacb3fdc329680ca7115aea8397659a)，android-ci run [39138009249](https://github.com/raydocs/tono/actions/runs/39138009249)（attempt 2 才 success）。两份盲审都只看这个 head；实施方自评在盲审完成前密封，没有发给评审。

下列文件按评审交付的原文逐字提交，没有改动任何分数、结论或文字；SHA-256 与下载的文件一致。

| 文件 | 内容 | SHA-256 |
|---|---|---|
| `2026-10-18-android-r6-gpt-6-1-sol.md` | GPT-6.1 Sol（`gpt61s`）盲审全文 | `c12dc8f43bf619fdc4dccf847028958b7df5cf1cb378887ca69c766f42240f71` |
| `2026-10-18-android-r6-gpt-6-1-sol-evidence.md` | GPT 证据清单 | `47584944d1999299078083b30a711a1462ac6c25080c0fe9d6eb60f4a775333c` |
| `2026-10-18-android-r6-gpt-6-1-sol-evidence-sha256.txt` | GPT 本地证据逐文件哈希（669 行） | `a869847c79541164333cd737e1e3096a93bae58f56d12f2d4126504f7f3d94ce` |
| `2026-10-18-android-r6-opus-5-5.md` | Claude Code `claude-opus-5-5` 盲审全文，取自评审线程的 `.amp/in/artifacts/android-1673-round6-blind-review.md` | `bd01b4652418ad5913dbcf2a39c680593a4dfd8995321b2bb3e988d29d99aed1` |
| `2026-10-18-android-r6-opus-5-5-evidence/u8.png` | Opus 引用的 u8 帧拼图 | `3bde98cde88bdeabc725d9c00784c61c810920bb0c402ee5cd6fd0e891e52662` |
| `2026-10-18-android-r6-opus-5-5-evidence/t.png` | Opus 引用的 tooltip 裁切 | `fb81a5ad046b592035430ae7f8bca2617c2f8e804f2ec8468496947d2f15d0a1` |
| `2026-10-18-android-r6-opus-5-5-evidence/tops.png` | Opus 引用的 zh/en 顶部对比 | `28192f1e2af280510112cf7944f0390f63537cfecbe6cb47fb343c71a7654649` |
| `2026-10-18-android-r6-self-assessment-sealed.md` | 实施方密封自评（盲审前写成，未改） | `8d6689d4ff4b9713943b442af5e40b55c20ab8e3439b1c06867a5f54b7268f5e` |
| `2026-10-18-android-r6-self-assessment-sealed-wording-note.md` | 密封自评的措辞说明（盲审前补写，分数未改） | `dc4b2b2fe58882cb3c24b9a7f08967a4446afebba70de2a2bee37cd2d9c3d903` |

评审线程：Opus [T-01a14fea-9e0f-7738-a0b8-fb8ba6aad8cd](https://ampcode.com/threads/T-01a14fea-9e0f-7738-a0b8-fb8ba6aad8cd)，GPT [T-01a14fea-a8e6-7559-b81f-28086c0be498](https://ampcode.com/threads/T-01a14fea-a8e6-7559-b81f-28086c0be498)。报告里的本地路径（`.amp/in/...`）指评审各自的工作环境，不在本仓库。GPT 证据清单与哈希文件对应的原始证据留在 GPT 评审环境中，没有入库；Opus 只入库了它在报告里点名的三张图。

## 盲审边界（照评审原文披露）

- 两位评审都只从固定 head 的 `docs/agent-reports/2026-10-18-mobile-opus-5-5.md` 提取 “Rubric（原样，不改标准）” 一节。这一节正文本身写着 “iOS 自评 91/100”，两位都看到了这个数字。
- Opus 为定位这一节运行了 `grep -n '^#'`，标题行带出了旧的 iOS 83/100 和旧 Android 79.5/100（head `c53eba6`）。
- GPT 声明没有看到旧 Android 分数。
- 两位都声明这些数字没有用作评分依据，没有读 PR 正文或评论里的旧评分，也没有读密封自评。

## 逐项并列（不取均值）

| 项（权重） | 70 % 线 | Opus 5.5 | GPT-6.1 Sol | 密封自评 |
|---|---:|---:|---:|---:|
| D1 信息层级／减字（20） | 14 | 17 | 18 | 18.5 |
| D2 交互连贯／单手（20） | 14 | 17 | 18 | 18.5 |
| D3 高级克制及最新桌面品牌一致（15） | 10.5 | 12.5 | 13 | 13 |
| D4 玻璃材质（15） | 10.5 | 11 | 13 | 12 |
| D5 状态动效（15） | 10.5 | 12.5 | 13 | 12.5 |
| D6 可访问性适配（10） | 7 | 8 | 8 | 9.5 |
| D7 真实性性能（5） | 3.5 | 3.5（正好压线） | **3（低于 70 %）** | 4 |
| **合计** | 85 | **81.5** | **86** | 88 |
| 一票否决 | | 不触发 | **触发：严重状态误导**（源码推论） | 未识别该问题 |
| 结论 | | **不通过**：总分低于 85 | **不通过**：D7 低于 70 %，且判否决 | 自评写“过门槛”；被两份盲审否定 |

**本轮正式结论：不通过。** 两份盲审各自独立不通过，理由不同：

- Opus 不通过是因为总分 81.5 低于 85。
- GPT 总分 86 过了总分线，但 D7 只有 3/5，低于 70 %；同时判定触发 “严重状态误导” 否决。

否决不因另一份评审没有触发、也不因三份分数的均值而消失。

**自评与盲审的差距**：

- 密封自评在 D1、D2、D6、D7 四项上都高于两份盲审。
- 自评没有发现 GPT 的 F1：引擎失联后首页仍沿用 Connected 快照。

## GPT 否决（F1）的边界

GPT 原文明确写了这个边界：该判断来自源码路径（`ui/EngineClient.kt` 的 `onServiceDisconnected` 只清空 `engine`、保留 `_snapshot`），**没有在设备上动态复现，也没有证实网络泄漏**。实施方后续的核实与修复另行记录，这里不把这条推论写成实测泄漏。

## 证据口径更正（实施方基线评论的措辞，数据不变）

1. **25/25 是跨 attempt 的合计**：
   - attempt 1 的 ui 12/12，加上 attempt 2 的 system 13/13，再加 t1 出口分流核对。
   - 没有哪一次 attempt 单独跑完 25 项。
   - system 不是首次通过。
2. **system 的 attempt 1 不只是“慢”**，job 内有两次模拟器会话：
   - 第一次会话：a1 通过；a2、a3 各自在 900 s 处被超时杀掉，记为 FAIL，没有产品断言输出。随后在 2186 s 被预算停止，a4 及之后未执行。期间出现 launcher ANR 和 `com.android.vpndialogs` ANR（`foreign-anr.txt`）。
   - 第二次会话：a1–a6、s1–s3、b1 共 10 项通过，在 2566 s 被预算停止，b2、b3、t1 未执行。期间同样出现 VpnDialogs ANR。
   - 基线评论原先写的“两台都极慢、被预算停止”漏了 a2/a3 的两条 FAIL 和 ANR。
3. **视频**：
   - 原始 MP4 只有 1 段，即 system artifact 里的设备录屏 `fixture-motion.mp4`。
   - 另一段“视频”是实施方用 u8 的 392 张 JPG 帧序列合成的派生视频，不是第二份原始录像。
4. **l3 横屏与 25/25 都不等于真实 MainActivity 横屏**：
   - l3 是在系统旋转后的测试宿主 `ComponentActivity` 里放夹具界面。
   - 它不覆盖真实 MainActivity 的 cutout 安全区，也不覆盖 OTP 输入加 IME 的横屏，或授权页的旋转恢复。
   - 也不是真机。
5. **JVM 单元测试计数**（GPT 指出）：mobile 41 项中有 17 项是 opt-in 的截图／动效预览，默认跳过，实际执行 24 项。lint 任务通过，但 SARIF 里有 24 条结果，不等于零提示。

## 建议并集（后续返工按此推进）

1. 引擎失联、`:vpn` 进程死亡、重连、过期快照时，不显示肯定的 Connected。App、QS、通知、widget 都不能虚报受保护。补故障注入回归测试（GPT F1）。
2. 真实 MainActivity 横屏，加 cutout／safeDrawing 安全区；OTP、IME、授权页的旋转恢复；`pendingConsent` 跨旋转保存（Opus 1、7；GPT F3）。
3. 去掉 “Drag handle” tooltip 和焦点方块对标题的遮挡，同时保留键盘可用（Opus 2）。
4. 中文夹具截图补 FIXTURE 标记，并与 edge-to-edge 一致（Opus 3）。
5. 状态切换的淡出淡入改为重叠，消除空白帧和标题裁字（Opus 4；GPT F5）。
6. system shard：健康门槛、挂起前 dump 窗口层级、更短的单测超时、按预算拆片；重跑后才通过的要标为 flaky（Opus 5；GPT F4）。
7. 在真实 App 里走一次 ConsentSheet 到系统授权对话框（Opus 6）。
8. 收窄 AI paused、Always-on 文案：Always-on 建议要提到“屏蔽未使用 VPN 的连接”，Home 探测措辞不要过于绝对（GPT F2）。
9. 细节：
   - 玻璃 tint 随天色变化（Opus 8）；
   - 本地已连接时线路行显示状态（Opus 10）；
   - Lines 面板上方的半截标题；
   - a6 改名或断言主题行为（Opus 9）；
   - 设置页展开／收起的硬编码英文（GPT F3）；
   - 断开时太阳收落节奏和水面倒影（GPT F5）。

Rubric、权重、门槛不变，不降低断言或审计。下一轮正式评分仍是实施方自评加独立盲审一起交付。
