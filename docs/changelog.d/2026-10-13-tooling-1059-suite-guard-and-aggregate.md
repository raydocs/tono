## 2026-10-13 · Issue #1059：测试套件登记守卫认通配符并进 CI，macOS 聚合脚本不再把跳过当通过
- 归属：ops 计划（工程/测试工具，非发布门）；`tooling/scripts`、`.github/workflows`、`services/home-agent` 测试。
- 来源：Issue #1059；分支 `claude/tooling-gaps`；尚未合 main。
- 缺陷修复（工程）：`T4-REGISTRATION-GLOB`：`test-suite-reachability.sh` 不认 `node --test "tooling/scripts/tests/*.test.mjs"` 这类通配调用，把已被通配运行的套件报成未接线；它自己也没有调用方，真实目录下一直是红的（20 项）。现在通配的文件名部分按 shell 模式匹配同一目录的套件（目录部分不允许通配，`*` 单独的文件名不算），触发过滤里的裸序列条目和注释仍不算接线；守卫接入 services-ci 的 ops-contract 作业并加入 `test-macos-all.sh`；`test_check_node_in_fleet.py`、`test_mac_sea_polish_metrics.py` 原先无调用方，接入 service-agents 作业（后者在 Linux 上先 `apt-get install python3-pil`）。services-ci 的触发路径随之加入守卫读取的文件。`T4-AGGREGATE-INSTALL-INPUT`：聚合脚本只传 `--app`，而 root 下安装生命周期脚本无法自行生成安装脚本，缺 `--script`；现要求 `TONO_TEST_INSTALL_SCRIPT` 并传 `--script`，缺输入或非 root 时作为「跳过」列出原因。`T4-AGGREGATE-HIDDEN-SKIP`：聚合脚本丢弃通过套件的日志，峰值鉴权套件在缺少签名身份时打印 `SKIP` 并以 0 退出，被算作通过；现在以 `SKIP` 开头的行使该套件被列为「跳过」并带原因。
- 已在更早提交修复，本 PR 只补测试：`HOME-AGENT-PEER-RETENTION-CAP`（#1439，`489a4d677`，终身基线上限 20,000，达到后新 peer 不计费只告警）；新增 `test_a_full_baseline_store_keeps_metering_known_peers_and_leaves_new_ones_unbilled`（不是红测试：对已有行为的固定）。不引入计数代数（见 #5）。
- 新增/优化：无。
- 工程与测试：`a wildcard invocation registers the suites it matches and no others`；`macos-all-aggregate.test.mjs` 两个测试（无 zsh 时在 Linux 跳过；macos-ci 单独按名运行）；`ci-gate-changes.test.mjs` 的期望路径表同步。
- 验证：见 PR 的 Verification 一节。未改任何 CI 门的强度；聚合脚本的 root 分支与真实安装未在本机运行。
- 候选/发布：无新候选。
- 剩余限制：峰值鉴权在 ci 模式的部分跳过（`::warning`）不被聚合脚本识别；`#956` 的底层跳过不变；守卫对「出现在非序列行里的路径」仍视为接线，不验证该行真的执行。
