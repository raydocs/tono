## 2026-10-10 · Windows 设置：隐私选择的读取、保存与失败反馈
- 归属：SHIP_PLAN G2 可理解的失败与下一手；Windows 设置 UI，不重做主页/连接页。
- 来源：基线 [230e32cf](https://github.com/raydocs/tono/commit/230e32cf0ceffed3168d7df5d5f2102ff4eba7a8)；分支 `amp/windows-settings-feedback`，本 PR；独立于 setup PR。
- 缺陷修复：无底层权限/采集行为变更。
- 新增/优化：三个隐私选择读取/保存时禁用；不再提前乐观确认，只有原 setter 返回成功才更新显示并提示已保存。失败保留最近显示值但明确不能确认，禁用继续修改并提供重新读取入口；不猜 IPC 失败后的实际值。说明自动保存、无需重连/重启、关闭上传不删除已发送数据。保留原简短/完整隐私说明、品牌、原生默认值与全部安全边界。
- 工程与测试：复用原 setter/cache/formatter，新增一条用户可见状态回归；生成翻译类型用 `pnpm i18n:types`。开发专用 shell preview 的隐私 IO 替身支持延迟、首次读取/保存失败及重新读取，无原生 IPC 或上传。
- 验证：Linux orb `pnpm exec vitest run src/pages/settings.test.tsx --maxWorkers=1`：`Test Files 1 passed / Tests 1 passed`；覆盖读取中/读取失败、保存中不提前确认、丢失回执后重新读取不同实际值、再次保存成功。`tsc --noEmit`、触及 TS 文件 ESLint、8 个文件 Biome format 检查均 exit0。此前翻译类型未生成导致的 typecheck 失败已用仓库生成器修复，未删断言或放宽类型。
- 候选/发布：无新包、无客户更新源变化；UI PR 不自动启用合并，原生验证与独立 Sol 评审按准确 head 另记。
- 剩余限制：截图为 Windows 生产 React 设置页在 Linux Chromium、合成 IO、2× DPR 的 web 渲染，不是 Windows 真机/原生 WebView 验收。macOS SettingsView 与 #1506 重叠，本轮不改；macOS 登录/更新 #1528/#1529/#1531 和 Windows #1478/#1495 仍由原线程所有权协调，不并入本 PR。
