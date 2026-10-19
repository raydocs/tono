# 2026-10-19 Android #1673 第 7 轮：两份独立盲审与密封自评并列

固定基线：head [`c18daa3d`](https://github.com/raydocs/tono/commit/c18daa3db114fb059e1190e6e0e7aa7635f715b9)，android-ci run [39176556620](https://github.com/raydocs/tono/actions/runs/39176556620)（run attempt 1；system 分片在 job 内全新模拟器重试后才通过，标 FLAKY）。两份盲审都只看这个 head；实施方自评在盲审前密封（SHA-256 已于盲审前交给 Puck），没有发给评审。

下列文件是评审交付原文的逐字副本，没有改动任何分数、结论或文字；SHA-256 与下载文件、评审给出的哈希一致。GPT 的报告以相对路径引用 `visuals/review-images/`，因此 GPT 的交付物按原目录结构放在同名目录下，报告里的三张图可以直接打开。

| 文件 | 内容 | SHA-256 |
|---|---|---|
| `2026-10-19-android-r7-opus-5-5/pr1673-r7-blind-review.md` | Claude Opus 5.5 盲审全文（评审线程 `.amp/in/artifacts/pr1673-r7-blind-review.md`） | `6e700638d42b05501e618628c1663a249aa633e56523e29e3a64874e0b0363e3` |
| `2026-10-19-android-r7-opus-5-5/pr1673-r7-evidence-manifest.txt` | Opus 证据清单 | `38095097358538c52cf0e13fe7415d3f6d3d712482de08e5e5cf7a68c312afb2` |
| `2026-10-19-android-r7-gpt-6-1-sol/REPORT.md` | GPT-6.1 Sol 盲审全文（评审线程 `.amp/in/artifacts/pr1673-r7/REPORT.md`） | `feb874bace7b1f37c6c741ca48cb926c7e7dfd36e7555b697b4c25094c48f714` |
| `2026-10-19-android-r7-gpt-6-1-sol/EVIDENCE.md` | GPT 证据说明 | `4894a8fbfa1b6f49994a8664de21062c92c260d8fc2b9519e80078c591da88e7` |
| `2026-10-19-android-r7-gpt-6-1-sol/EVIDENCE.tsv` | GPT 逐文件/ZIP 成员证据索引 | `3437b70a02325ef689d4da15edacd8917bb47cca92c59ad19b0b177269b4ab2d` |
| `2026-10-19-android-r7-gpt-6-1-sol/SHA256SUMS` | GPT 交付目录全部文件哈希 | `5056c03e4be5990553c1b7bc434d603148832739ed943234f3cc2f708059308c` |
| `2026-10-19-android-r7-gpt-6-1-sol/visuals/review-images/real-states.jpg` | 报告引用图 | `b499be363cbc2609a343f7110f55a03fd61ca85546566c2bb815a9e7e86c8ff2` |
| `2026-10-19-android-r7-gpt-6-1-sol/visuals/review-images/real-200percent.jpg` | 报告引用图 | `6cde467e5069f20565c941b93e54d63477ee2987050ac798623ca8b2d8247eb7` |
| `2026-10-19-android-r7-gpt-6-1-sol/visuals/review-images/real-landscape.jpg` | 报告引用图 | `754942264c993733a8bd87a622c5140f7dbe42bfea36600805468be13d967287` |
| `2026-10-19-android-r7-self-assessment-sealed.md` | 实施方密封自评（盲审前写成，未改） | `131215dbec942e56116bb47af63d894cf528fe0480a3dbafa26f9abe3cb99ca6` |

评审线程：Opus [T-01a15171-0ef1-765a-a2a7-1de1deaab907](https://ampcode.com/threads/T-01a15171-0ef1-765a-a2a7-1de1deaab907)，GPT [T-01a15171-48b8-77da-8e22-9a2b4715ea37](https://ampcode.com/threads/T-01a15171-48b8-77da-8e22-9a2b4715ea37)。GPT 的 `SHA256SUMS`、`EVIDENCE.tsv` 列出的原始 ZIP、源码快照与其他视觉附件留在 GPT 评审环境中，没有入库；Opus 清单里的 zips/logs/art 与 `pr1673-r7-sheets/` 同样留在 Opus 环境。

## 盲审边界与污染（照评审原文披露）

- 两位都在提取 rubric 一节时看到了该节正文里的 iOS 旧自评 “91/100”。
- Opus 为定位 rubric 运行了 `grep '^#'`，标题行还带出了旧的 “iOS … 83/100” 与 “Android … 79.5/100”。
- GPT 声明没有看到 Android 旧分数，并写明“不能声称完全零旧分数曝光”。
- 两位都声明没有用这些数字评分，没有读其他 PR 评论、其他报告、实施线程或密封自评。
- 这是 rubric 来源文件本身的问题：下一轮盲审应只给评审 rubric 原文一段，不让评审打开带分数的文件。

## 逐项并列（不取均值）

| 项（权重） | 70 % 线 | Opus 5.5 | GPT-6.1 Sol | 密封自评 |
|---|---:|---:|---:|---:|
| D1 信息层级／减字（20） | 14 | 17.5 | 18 | 18.5 |
| D2 交互连贯／单手（20） | 14 | 17.5 | 18 | 18.5 |
| D3 高级克制及最新桌面品牌一致（15） | 10.5 | 12.5 | 12 | 13 |
| D4 玻璃材质（15） | 10.5 | 11 | 11 | 12 |
| D5 状态动效（15） | 10.5 | 11.5 | 11 | 12.5 |
| D6 可访问性适配（10） | 7 | 8.5 | 8 | 9.5 |
| D7 真实性性能（5） | 3.5 | 3.5（压线） | **3（低于 70 %）** | 4 |
| **合计** | 85 | **82**（不通过：总分） | **81**（不通过：总分、D7） | 88 |
| 一票否决 | | 不触发；但“应用关闭时引擎死亡、通知仍显示 Connected”判为**发布阻塞（至少 major）** | **触发：严重状态误导**（条件明确的源码缺口，当前 head 后台未复现） | 未判为否决，列为残余 |

密封自评高于两份盲审 6–7 分，且把后台通知列为“残余”而不是阻塞；两位评审都不接受这一定性。**残余不视为 owner 已接受。**

## 计数口径更正（两位评审核实）

基线评论写的 “设备测试 29/29，另加分流核对 1 项” 多算一项。准确口径：

- ui 首次 12/12；tunnel 首次 **7/7 设备测试 + 1 项 CI 侧出口日志核对**；system **首轮 8/9**（s1 失败），job 内全新模拟器重试 9/9，FLAKY 保留。
- 合计 **28 个设备测试 + 1 项分流核对 = 29 项检查**。
- JVM（CI 的 HTML 报告，CI 未上传 XML）：mobile **发现 46、执行 29、跳过 17（ScreenshotRender 15、MotionPreview 2，按需截图）、0 失败**；routing 执行 16、0 失败。不能写成“46 项执行”。
- run attempt 1 与 job 内重试是两回事；首个 emulator step 是 `continue-on-error`，jobs API 里它显示 success 不代表首轮通过。

## 建议并集与处理

| # | 来源 | 问题 | 处理（本轮） |
|---|---|---|---|
| 1 | 两位 | UI 进程不在、引擎死亡、系统保留通知又不重启时，通知没有独立失效机制；前台 t1 约 5.85 s 恢复不能证明后台 | 修复并补后台故障证据，见 README “Round 8” 与 changelog |
| 2 | 两位 | 计数口径（28+1、7+1、8/9、JVM 发现/执行） | 已更正；CI 改为同时上传 JVM XML |
| 3 | GPT | 200 % 只测 idle 首页，未覆盖全部状态 | t4 扩到真实已连接、部分可用、失败 |
| 4 | GPT | a2 由测试直接启动系统授权框；a4 无界面 | 照实标注；普通 Connect 流程由 t1 覆盖 |
| 5 | GPT/Opus | 挖孔检查按尺寸排除所有全窗口节点、不保证 cutout 非空、只测 90° | 只排除带 “Close sheet” 语义的遮罩；断言 cutout 非空并写入证据；补 270° |
| 6 | GPT | gate 1000 ms 是准入放宽，不能当性能通过 | 照实改口径；性能分不以 gate 计 |
| 7 | 两位 | `CATALOG_UNAVAILABLE` 一律显示 “Home exit unavailable” | 改为不指向 Home 的目录不可用原因 |
| 8 | Opus | 部分可用时读屏读出 “Disconnect, Connected for …” | 计时的读屏文字不再用 Connected |
| 9 | Opus | “Engine stopped” 偏工程术语 | 改为面向用户的说法 |
| 10 | GPT | A11yContract 不查宽度溢出、无角色无标签可点节点 | 检查器补上这两项 |
| 11 | 两位 | perf.txt gfxinfo 0 帧（在移除动画后测） | 测量前恢复动画；仍只是测量 |
| 12 | 两位 | 玻璃偏烟色、海面反射简化、连接中与已连接天空相近、真机流畅度/TalkBack/真实服务未验证 | 连接中天空与已连接拉开；其余需真机/真实账号，照实列为未验证 |
| 13 | Opus/GPT | t1 的 1.5 s 宽限只在移除动画下验证；回前台首帧未录 | 照实标注未验证 |
| 14 | GPT | Widget “约 100 s” 不是严格上界 | 改口径 |
