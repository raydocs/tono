| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M3 | macOS helper 启动时判断 Tono 是否已删除：任何没有可读 `Contents/Info.plist` 的 `*.app`（Apple silicon 上常见的 iPhone/iPad 包装应用，只有 `Wrapper/` 与 `WrappedBundle`）都算「Tono 还在」，删掉 Tono 后移除释放不发生 | in-PR | [#679](https://github.com/raydocs/tono/pull/679) | 中·已确认 | `<entry>/Contents` 的 lstat 得 ENOENT 或 ENOTDIR 时跳过该项，其余情况照旧。有 `Contents` 但 Info.plist 读不出的包仍算 Tono；移除只在 helper 启动时检查（BRICK-M11）；未实机验证 |

来源：brick 审计 2026-09-28（基线 origin/main `c0e7758e`），opus MAC-3，codex 覆盖表 M8 与 codex 复核双方确认。
续 H19-O-F1 = H19-G-F1（删 Tono.app 后 helper 每次开机重新 arm）。
