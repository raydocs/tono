| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-NATIVE-UPDATE-MISSING-SINGBOX-PIN | Windows 原生更新的磁盘 sing-box pin 同步被误认为正式版缺 pin；实际剩余项是 resources pin 事务暂存未清理及更新成员说明缺失 | in-PR | [#1739](https://github.com/raydocs/tono/pull/1739) | 低·已确认（P2，卫生问题） | `installer.nsi:1041-1043` 在 repair-evidence guard 内清理 resources pin 三种事务暂存；`windows-packaging.mjs:104-106,189` 检查路径及 guard；`update_executor.rs:634-638` 明确无需再复制 Service 目录磁盘 pin。RED ba1a73dd9 → GREEN80443f2aa（41/41 Node），安装/卸载实机未验；不覆盖 ProgramData dev pin 的额外同步或卸载清理 |

优先级更正（所有者追加任务）：release/candidate 构建内嵌 `TONO_SING_BOX_SHA256`，不是安全 pin 丢失。证据：`.github/workflows/windows-release.yml:243`、`windows-candidate.yml:122`、`crates/tono-core/src/sing_box/select.rs:63-67`、`service/src/core/runtime_generation/core_integrity.rs:199-203` 均先用编译 pin。磁盘文件只在没有编译 pin 时作为 fallback；本 PR 不改这些信任优先级、摘要值或校验逻辑。

原生 updater 通过 `collect_candidates` 处理 App payload（含 resources pin）；ProgramData 的额外成员列表保持不变，仅补充原因注释。旧 R6-WIN-UNINSTALL-SING-BOX-PIN 记录仍保留，不把它尚未处理的 ProgramData 外观问题写成已修复。
