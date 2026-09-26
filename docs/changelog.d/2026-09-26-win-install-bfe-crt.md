## 2026-09-26 · Windows：BFE 停止时可以安装；门禁 helper 不再依赖 VC++ 运行库
- 归属：G3（可安装性），客户 0.0.73 发布阻断；影响 Windows Service 安装 helper（`install_service.rs`、
  `update_executor.rs`）、Service 构建配置、NSIS `.onInit`、发布预检与 App 修复横幅文案。发现 H22-O-F1、H22-O-F2。
- 来源：基线 origin/main `f15e95a7`；红分支 `wip/win-install-bfe-crt-red`（`76646679`），修复分支
  `fix/win-install-bfe-crt-20260926`，[#658](https://github.com/raydocs/tono/pull/658)；未合 main。
- 缺陷修复：
  - H22-O-F1：BFE 停止或禁用时，`.onInit` 的 `--manual-update-gate` 先读 WFP（RPC 到 BFE）而失败，安装以通用
    「无法安装」中止（76）；原来的 BFE 自修复排在门禁读 WFP 之后，永远跑不到，App 横幅「修复」同样失败。
    改后：门禁、无参修复和 `--replace-runtime` 在第一次读 WFP 前先把 BFE 拉起：停止则启动，StartPending 等待
    （30 秒上限）。BFE 被禁用时不改启动类型（暂定决定，见 DECISIONS.md），门禁仍拒绝，读不到 WFP 仍不算
    「无残留过滤器」，但退出 79，NSIS 显示 BFE 专用提示（中/英/俄）和 `sc.exe config BFE start= auto`、
    `sc.exe start BFE`；App 修复失败的提示也补上 `sc.exe config BFE start= auto`。去掉原来静默执行的
    `sc config BFE start= auto`。
  - H22-O-F2：三个 tono-service*.exe 直接导入 `VCRUNTIME140.dll`，而 `.onInit` 早于 VC++ 运行库安装小节就运行门禁，
    没有该运行库的机器无法安装。改后：`apps/windows/service/.cargo/config.toml` 对 `x86_64-pc-windows-msvc` 静态链接 CRT；
    `build-windows-release.sh/.ps1` 改为在 service 目录运行 cargo，使该配置生效（CI 工作流本来就在该目录构建）。
- 新增/优化：`release:preflight --payload-only` 检查安装包内每一份 tono-service*.exe（包括 `$PLUGINSDIR/tono-gate` 那一份）
  的导入表和延迟导入表不含 `VCRUNTIME*`/`MSVCP*`，并要求读到 KERNEL32（防止解析失败被当作通过）。VC++ 运行库安装小节保留。
- 工程与测试：新增 `update_executor::tests::update_manual_gate_brings_bfe_up_before_reading_wfp`（脚本化 BFE：
  Stopped→start→Pending→Running 之后才读 WFP）。红分支把 main 的行为原样抽成同名接缝（门禁不先拉起 BFE），测试应以
  断言失败；`windows-packaging.test.mjs` 的 NSIS 拒绝对话框断言加上 79 分支、`manualInstallNeedsBfe` 三语和 79 常量。
- 验证：MacBook 未运行 cargo；本机只跑了 `node --test scripts/windows-packaging.test.mjs`（33 通过；换回旧 NSIS 时
  拒绝对话框断言失败）和 `rustfmt --check`（改动处无新增格式差异），并用新的导入表检查读 fb5e8485 候选安装包：
  六份 tono-service*.exe 均报 `VCRUNTIME140.dll`。
  - 红（`76646679`）：Windows CI [36227938281](https://github.com/raydocs/tono/actions/runs/36227938281) service job
    在 `update_manual_gate_brings_bfe_up_before_reading_wfp` 断言失败（left `["wfp"]`），其余 job 通过；候选
    [36227941946](https://github.com/raydocs/tono/actions/runs/36227941946) 在 payload 预检失败：
    `resources/tono-service.exe imports the Visual C++ runtime (VCRUNTIME140.dll)`。
  - 修复（`acf916d9`）：Windows CI [36228201853](https://github.com/raydocs/tono/actions/runs/36228201853)（dispatch）与
    [36228200928](https://github.com/raydocs/tono/actions/runs/36228200928)（pull_request）四个 job 全绿，新测试在
    lifecycle 与 executor 两步均通过；候选 [36228203218](https://github.com/raydocs/tono/actions/runs/36228203218) 构建与
    payload 预检通过（安装包 SHA-256 `20fa693ebd6c3e035d1b3503120c7aa2371caa2695f406b145e7699cae79ee30`，本机复查六份
    helper 均无 `VCRUNTIME*`/`MSVCP*`/`api-ms-win-crt-*` 导入）；安装冒烟
    [36229560874](https://github.com/raydocs/tono/actions/runs/36229560874)（install/repair/uninstall，windows-2025，BFE 正常、
    runner 已有 VC++ 运行库）通过。
- 候选/发布：无发布候选；候选工作流 36228203218 的未签名内部包只用于验证预检和安装冒烟。
- 剩余限制：未在 BFE 停止/禁用、以及未装 VC++ 运行库的干净 Windows 上实机安装；卸载门禁拿到 79 时仍显示通用卸载拒绝文案；
  自动更新（SYSTEM 执行器）路径未改。
