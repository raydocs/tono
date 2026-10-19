# Android #1673 orb 资料归档（2026-10-19）

本目录是 Android 实施 orb（Amp 线程 T-01a14a6e-7a99-745c-ab7f-888543f76c3b）里只存在于 `.amp/in/`（被 `.gitignore` 忽略）的报告、回顾与 CI 证据副本。文件按原样复制，没有改写。实现处于暂停状态：本归档不含任何产品代码改动。

- 归档时的 head：Tono-droid `feat/mobile-singbox-premium` = `12ac6d504023bd895e2b0fbef0c828f856ee28a1`；raydocs/tono `feat/android-singbox-horizon` = `f769fc43b0d9c73062f126e8edfb734467aa1f9e`。两处工作树都干净，与远端一致。
- 完整性：`MANIFEST.sha256` 列出本目录每个文件（不含它自己）的 SHA-256，可用 `sha256sum -c MANIFEST.sha256` 校验。
- 敏感信息：已对所有文本文件做模式扫描（GitHub/AWS/Slack/OpenAI/Google 密钥形态、私钥头、Bearer/JWT、password= 等），没有发现密钥。CI 日志里的 GitHub 认证头均已被 Actions 掩码为 `***`。日志里的 `password="false"` 是界面树属性。logcat 里的 iccId、蓝牙 UUID 是模拟器默认值。PNG/MP4 等二进制文件没有做文本扫描；截图与视频的人工检查见“补档”一节的“敏感内容检查”。

## 内容与来源

| 路径 | 来源 | 说明 |
|---|---|---|
| `r9d/` | Actions 原始副本（解压） | run [39202302351](https://github.com/raydocs/tono/actions/runs/39202302351)（head `048b2a274`）全部 artifact，用 `gh run download` 下载。按单个文件排除了两个 APK，见“未放入、但有稳定来源的文件”。与 Actions zip 没有逐字节比对（Actions 只给 zip 的 digest，见下表）。 |
| `r9e/tunnel/` | Actions 原始副本（解压） | run [39209120069](https://github.com/raydocs/tono/actions/runs/39209120069)（head `f769fc43b`）artifact `android-emulator-evidence-tunnel`。 |
| `r9e/lost-small.png` | orb 派生 | 由 `r9e/tunnel/evidence-attempt-1792391927/local-engine-lost.png` 缩到 30 %。 |
| `retro/jobjson/*.json` | Actions API 原始响应 | 每个 job 的 `GET /actions/jobs/{id}`（154 个）。 |
| `retro/logs2/*.txt` | Actions API 原始日志 | 每个模拟器 job 的 `GET /actions/jobs/{id}/logs`（99 个），按 job id 取。回顾数据以它为准。 |
| `retro/logs/*.txt` | Actions 日志（`gh run view --log --job`） | **注意**：多次 attempt 的 run（39100236753、39138009249、39167725741），第 1 次 attempt 的 job 在这里拿到的是最新 attempt 的内容。保留只作记录，不作依据。 |
| `retro/log-sys.txt` | Actions 日志 | run 39209120069 system job（`gh run view --log`）。 |
| `retro/log-117919884961.txt`、`log-117919884989.txt`、`log-117919885010.txt` | 空文件（0 字节） | 第一次取日志时被 gh 的转义检查拒绝，留下空文件，保留原样。 |
| `retro/runs.tsv`、`retro/jobs.tsv` | Actions API 摘录 | 52 个 android-ci run 与各 attempt 的 job 起止时间。 |
| `retro/parse.py`、`retro/table.py`、`retro/emu.json`、`retro/table.txt` | orb 派生 | 解析脚本及其输出（每个模拟器会话的启动时长、健康帧时、PASS/FAIL/HANG/门槛）。 |
| `retro-android/` | orb 派生 | 回顾汇总 `README.md`，以及 `table.txt`、`runs.tsv`、`jobs.tsv`、`emu.json` 的副本（与 `retro/` 同名文件字节相同）。 |
| `make-sheets.sh` | orb 脚本 | 从 evidence 目录生成证据拼图与 GIF 的脚本。 |
| `orb-derived/evidence-sheets/round6/`、`round7/`、`r8/` | orb 派生 | 第 6/7/8 轮基线评论中引用的证据拼图、GIF、MP4（由 `make-sheets.sh` 从对应 run 的 artifact 生成）。当时以公开链接发在 PR 评论里，没有与线上副本比对字节。 |
| `orb-notes/rubric.md`、`rubric6.md` | orb 笔记 | 实施方摘录的评分量表文本（权威原文在 `docs/agent-reports/2026-10-18-mobile-opus-5-5.md`）。 |
| `orb-notes/repeat-note.md` | orb 笔记 | 第 6 轮重复运行记录草稿。 |
| `orb-notes/fetch-evidence.sh` | orb 脚本 | 早期下载并合并两个模拟器分片证据的脚本。 |

Actions artifact 的保留期与 digest（只读查询）：

| run | artifact | 大小（字节） | 到期 | digest |
|---|---|---:|---|---|
| 39202302351 | android-emulator-evidence-tunnel | 18063132 | 2027-01-17 | sha256:a67d78d0… |
| 39202302351 | android-emulator-evidence-ui | 17872334 | 2027-01-17 | sha256:ef1eb401… |
| 39202302351 | android-emulator-evidence-system | 11758538 | 2027-01-17 | sha256:9b1defa1… |
| 39202302351 | tono-mobile-0.3.1-test-048b2a274 | 45024354 | 2027-01-17 | sha256:2d088010… |
| 39202302351 | android-test-reports | 116346 | **2026-11-18** | sha256:c0545fca… |
| 39202302351 | instrumentation-apk | 4437048 | **2026-11-02** | sha256:3da154af… |
| 39209120069 | android-emulator-evidence-tunnel | 37060346 | 2027-01-17 | sha256:7ae2ea18… |

## 未放入、但有稳定来源的文件

| 原路径（orb `.amp/in/` 下） | 大小（字节） | sha256 | 说明 |
|---|---:|---|---|
| `r9d/tono-mobile-0.3.1-test-048b2a274/tono-mobile-0.3.1-test-048b2a274.apk` | 65101335 | `755e617db7dd94caef052e3e67a310f834196111c96b785f625997bc598f3ff5` | 超过 20 MB，只列清单。已重新下载 run 39202302351 的 artifact `tono-mobile-0.3.1-test-048b2a274`，字节一致（到期 2027-01-17）。 |
| `r9d/instrumentation-apk/instrumentation.apk` | 10748613 | `e4fcd2fec5644f2ae800c4758564c37dd87aacc8d6bacca6beb4f68af89f9062` | 未超过 20 MB。与 run 39202302351 的 artifact `instrumentation-apk` 字节一致（到期 2026-11-02），所以不重复放入。 |

（更正：首次交付的本 README 曾把 instrumentation.apk 和超限 APK 并列写成“跳过”，措辞不准，以本节为准。）

## 已在 GitHub 仓库中（不重复归档）

orb 里的这些副本与 `raydocs/tono` 分支 `feat/android-singbox-horizon`（`f769fc43b`）中的文件字节相同（按 git blob 哈希比对）：

- `reports/{opus.md,opus-evidence.md,gpt.md,gpt-evidence.json}` → `docs/agent-reports/2026-10-18-mobile-{opus-5-5.md,opus-5-5-evidence.md,gpt-6-1-sol.md,gpt-6-1-sol-evidence.json}`
- `reviews6/{opus-report.md,gpt-report.md,gpt-evidence-list.md,gpt-evidence-sha256.txt,opus-t.png,opus-tops.png,opus-u8.png}` → `docs/agent-reports/2026-10-18-android-r6-*`
- `reviews7/opus/*`、`reviews7/gpt/*`（含 3 张 visuals jpg）→ `docs/agent-reports/2026-10-19-android-r7-{opus-5-5,gpt-6-1-sol}/`
- `reviews8/opus/{REVIEW.md,EVIDENCE.md,ci-artifact-files.sha256}`、`reviews8/gpt/{report.html,evidence-inventory.json,SHA256SUMS}` → `docs/agent-reports/2026-10-19-android-r8-{opus,gpt}/`
- `artifacts/round6/self-assessment-SEALED{,-wording-note}.md`、`artifacts/round7/self-assessment-SEALED.md`、`artifacts/2026-10-19-android-r8-self-assessment-sealed.md` → `docs/agent-reports/2026-10-1{8,9}-android-r{6,7,8}-self-assessment-sealed*.md`
- `baseline-note.md`、`baseline-r7.md`、`baseline-r8.md` → PR #1673 评论 6252491669、6256737598、6257957522（正文相同，只差评论末尾多一个空行）

## 补档：orb 里其余资料（第二批）

`orb-only/` 按 `.amp/in/` 下的原路径保存那些只存在于 orb、且不超过 20 MB 的文件（466 个，205,017,421 字节），文件内容未改。`INVENTORY-orb.tsv` 逐个列出本次盘点的 17,266 个文件（不含下面的缓存目录与 `mono/`），写明类别、去向、大小、sha256 和来源：

| 类别 | 文件数 | 处理 |
|---|---:|---|
| ACTIONS | 14,658 | 与 Actions artifact 原件字节一致（52 个 run 中有 49 个有 artifact；重新下载了其中全部 184 个非 APK artifact，以及 orb 里有副本的 4 个 APK artifact，按文件 sha256 比对），不重复放入。来源写成 `actions:<run>/<artifact>/<文件>`；各 artifact 的 digest 和到期时间见 `actions-artifacts.tsv`（没有已到期的；`android-test-reports` 和 `instrumentation-apk` 约 30 天到期，证据类到 2027-01-16/17）。 |
| ARCHIVED-1 | 1,903 | 与首批归档里的文件字节一致（包括 `sheets-r7/` 等重复副本）。 |
| GITHUB | 151 | 与 raydocs/tono `f769fc43b`、raydocs/tono `59082ac`（`ref/desktop` 的检出）或 rw8/Tono-droid `12ac6d5` 中的 blob 字节一致。 |
| UNIQUE | 466 | 已放入 `orb-only/`。 |
| DUP | 76 | 与另一个已放入的 orb 文件字节相同，reference 列写了被复制的那份。 |
| OVER-20MB | 4 | 只列清单：`artifacts/android/tono-mobile-0.3.0-test-df28144.apk`（69,671,990）、`artifacts/android/r2/tono-mobile-0.3.0-test-4bb6536.apk`（69,681,820）这两个早期本地构建的测试 APK 没有 Actions 副本，是 orb 里唯一的一份；`libbox-out/x/jni/{arm64-v8a,x86_64}/libbox.so`（46,673,952 / 49,563,328）是 libbox 二进制，由固定源码可再生成，规则也不允许提交。 |
| UNIQUE-EXCLUDED | 5 | `libbox-out/x/` 下 3 个 libbox 解包文件；`lt/fake/.../qemu-system-x86_64-headless`（ELF 测试桩）；`handoff/tono-mobile-handoff.tgz`（已解包比对，与 `handoff/pkg/` 完全一致）。 |
| SENSITIVE-EXCLUDED | 3 | `lt/client.json`、`lt/cat.json`、`lt/work/server.json`：本地替身出口的 VLESS UUID、Reality 密钥与 SOCKS 用户名/密码。这些是本地测试时生成、只在 orb 内替身里用过的夹具值，不是 Tono 服务凭据，但按“凭据形态不入库”排除。 |

没有放入的目录（不是唯一证据，可再生成或已在别处）：

| 目录 | 文件数 | 字节 | 原因 |
|---|---:|---:|---|
| `mono/` | 5842 | 522311461 | raydocs/tono 检出，即 GitHub 分支本身 |
| `ref/` | 5901 | 1349090504 | raydocs/tono `59082ac` 的干净检出（`git status` 为空），该 commit 在 GitHub 上 |
| `gh-fresh/` | 13167 | 1590970775 | Gradle 缓存与守护进程目录 |
| `sb/` | 1665 | 11682778 | sing-box 源码，固定 commit `25b0d5ea`（上游 GitHub），未逐字节核对 |
| `src-ui/`、`atf1/`、`aarx/`、`y/` | 381 / 451 / 1 / 6 | 4619919 / 3671307 / 236657 / 96474452 | 依赖库的源码 jar 与 AAR 解包（Maven 可再下载；`y/` 含 libbox AAR 解包） |
| `libbox-out/`、`libbox-out2/` 的 `libbox.aar` | — | — | libbox 二进制，按规则不提交；`libbox.aar.sha256` 与 `libbox.provenance.json` 已在 GitHub 或已归档 |

敏感内容检查（第二批）：所有文本文件都做了凭据模式扫描（命中的只有蓝牙 UUID、界面树 `password="false"`，以及上面排除的 3 个夹具文件）。292 张唯一截图以约 300 px 缩略图逐张人工看过，5 段唯一 MP4 用抽帧拼图看过：都是模拟器、夹具或设计稿画面，看到的邮箱只有 `tester@example.com`、`tester@local.test`、`not-an-email`，没有发现凭据或个人信息。缩略图看不清极小的文字，没有做逐像素 OCR；`settings.dat`（模拟器崩溃库，40 字节）等二进制没有解析内容。

## 首批交付中的“未归档”清单（已被补档取代）

首批 README 在这里按目录粗列了“未归档”的 orb 资料。第二批已逐文件盘点并补档，以上一节和 `INVENTORY-orb.tsv` 为准：其中 `r8b/`、`sheets26/`、`sheets29/`、`preview12/`、`artifacts/run14–17`、`artifacts/run22–23`、`artifacts/android/`、`artifacts/design/`、`scratch/`、根目录 PNG 与日志、`handoff/pkg/`、`fixbak/`、`iosref/`、`wf/`、`lt/` 的非敏感文件等，凡不在 GitHub、不与 Actions 原件或首批归档字节相同的，都已放入 `orb-only/`。
