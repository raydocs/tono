## 2026-10-24 · 四端状态意图契约与 CI 覆盖缺口
- 归属：跨端状态显示规则，不是 SHIP_PLAN G1–G4 门，也不是 ops 计划的发布项。影响 iOS、Android、macOS、Windows 的契约测试和 ci-gate。
- 来源：基线 `322f48c6f` → 分支 `fix/t8-state-rule`；[#1746](https://github.com/raydocs/tono/pull/1746)。契约 `ed266e390`，CI `2bfb67d94`。未合 main。
- 缺陷修复：不改各端产品行为。已知不一致留在夹具的 `expected-failure`，没有探针的行是 `todo`。`IOS-1672-STATE-AUTHORITY` 保持 open。
- 新增/优化：决策 134（未占用 133）。共享场景夹具 `docs/contracts/state-intent-scenarios.json` 和错误码允许表。iOS TonoKit、Android JVM、macOS TonoTests、Windows `tono-core` 各一份表驱动契约测试。账户码引用 PR 1738 head `429e23427`（契约首提交 `3205b5c76`），不复制该文件，不改那条分支。
- 工程与测试：四份契约测试读同一夹具。`enabled` 断言相等，`expected-failure` 断言不等，`todo` 不跑产品探针。错误码扫描对未列出的渲染和过期允许项失败。CI 接线在后续提交。
- 验证：见下方续记。未跑 `swift test`、`xcodebuild`、`cargo`（这台 MacBook 不跑这些）。
- 候选/发布：仅源码，无新候选。未改 feed、迁移、签名或部署脚本。未合并，未部署，未发布。
- 剩余限制：macOS 与 Windows 产品行仍是 todo。iOS 用户断开、登出、套餐、额度、重新验证、连接中复查，以及 Android 的套餐、额度、重新验证和连接中复查，探针仍与契约不一致。封存收据 `docs/agent-reports/2026-10-19-ios-r12-receipts/stubs/LibboxStub.swift` 的空 `serviceClose` 未改；T1 拥有活动副本。T6 全量套件 1065 通过 / 2 失败是该 PR 未改的旧 401 断言，不是本 PR，也不能当成全绿。

### 2026-10-24 续记 · 本地检查
- 红：改 CI 之前，`services-ci.yml` 没有 `test_systemd_cadence.py`，`ci-gate.yml` 没有两份 `sync-desktop-routing.py --check`，也没有调用 `ios-ci.yml`。
- 错误码扫描（本机 Python，与测试同一规则）：iOS 3 处、Android 6 处均在允许表内；macOS、Windows 0 处。无未列出项，无过期允许项。
- 四端产品套件未在本机执行。`expected-failure` 用不等断言：产品一旦改到与契约一致，该行会变红，直到把 enforcement 改成 `enabled`。
- 契约提交 `ed266e390`。

### 2026-10-24 续记 · CI
- ci-gate 以 `apple: false` 调用 `ios-ci`，pull request 只跑 Linux 路由作业。macos-26 仍只在 push `main` / `feat/ios-**` 和 `workflow_dispatch` 时跑。`ios-ci` 没有 `pull_request` 触发。
- ci-gate 的 changes 作业增加 `apps/ios/tools/sync-desktop-routing.py --check` 和 `apps/android/scripts/routing/sync-desktop-routing.py --desktop --check`。`services-ci` 增加 `python3 services/exit-agent/test_systemd_cadence.py`。
- 绿：`node --test tooling/scripts/tests/ci-gate-changes.test.mjs` 9 pass。两份 routing `--check` 通过（iOS “matches the desktop lists”，Android “matches desktop checkout”）。cadence `Ran 5 tests` `OK`。
- Android JVM 测试未跑：现有 JDK 17 能启动 Gradle，但 `:mobile:verifyLibbox` 因缺少 `mobile/libs/libbox.aar` 失败。未构建 libbox。
- 这三项是工程覆盖，不进发现总账。

### 2026-10-24 续记 · ci-gate 两处失败
- 来源：[#1746](https://github.com/raydocs/tono/pull/1746) head `7de312969`，run `40084102769`。`services / ops-contract` 与 `ios / TonoKit + sing-box route checks (Linux)` 失败。不是基础设施抖动，没有 `gh run rerun`。
- 记录检查：`records.test.mjs` 要求编号决策文件与 `## ` 标题一一对应（131 ≠ 130）。决策 134 的中文标题降为粗体，正文保留。英文 `##` 仍是唯一二级标题。没有放宽该测试。
- 路由检查：`swift test` 135 通过。`stable-socks-home.json` 149 项通过。三个三层配置只在 `ipinfo.io` 上失败。`93.184.216.34` 是 harness 本地 DNS 桩的固定 A 应答，表示查询离开了进程，不是公网解析抖动。`ipinfo.io` 不在 Home/Cloud 名单里；三层对未收录名字走本地解析（与 `www.baidu.com` 的路由单测相同），稳定模式的 catch-all 仍要求 FakeIP。受保护名字仍必须 FakeIP，出现在本地桩里即失败。Android 同文 harness 一并改，避免两份分叉。未改 sing-box 规则，未放宽防泄漏。
- 本机未跑 `swift test`、`check-singbox.sh`（需要 Swift 与 Linux sing-box）。记录检查在本机重跑。
