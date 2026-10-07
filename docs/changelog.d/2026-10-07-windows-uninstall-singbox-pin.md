## 2026-10-07 · Windows 卸载清掉 `sing-box-sha256.txt`（#1319）
- 归属：运维计划（R6 打包扫描遗留，P3 cosmetic）；`apps/windows/service` 卸载程序。老板 2026-10-07「开始修复」。
- 来源：main `a990641df` → 本 PR；关闭 [#1319](https://github.com/raydocs/tono/issues/1319)。
- 缺陷修复：`install_service.rs` 的 `publish_sing_box_digest_pin` 在 Service 安装目录写 `sing-box-sha256.txt`（及 `.tmp`），`uninstall_service.rs` 的 `remove_windows_service_binary` 只清 `core-sha256.txt(.tmp)`，所以卸载后 `%ProgramData%\Tono\bin\sing-box-sha256.txt` 留下。编译期 pin 始终优先（`core_integrity.rs`），所以没有功能影响，只是残留。改后：清单抽成 `INSTALL_DIR_SWEEP` 常量，加入两个 sing-box 名字；其余清单项、顺序和 best-effort 语义不变。
- 新增/优化：无。
- 工程与测试：一条 `#[test] uninstall_sweeps_every_published_digest_pin`：两种 digest pin 及各自 `.tmp` 都在清单里。旧代码上该测试对 `sing-box-sha256.txt` 失败（清单里没有）。
- 验证：MacBook 不跑 cargo；证明是本 PR 精确 head 上的 `windows-ci.yml`（Service `cargo test --locked`）。未在 Windows 实机做卸载残留检查。
- 候选/发布：仅源码。7503 候选（`a990641df`）不含本项；按 #1319 的 P3 cosmetic 级别不重出候选，进下一次冻结。
- 剩余限制：`install_service/update_executor.rs` 的更新发布清单与卸载清单是两份手写列表，没有共享常量；本 PR 只改卸载侧。
