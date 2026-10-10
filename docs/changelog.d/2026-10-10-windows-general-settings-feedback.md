## 2026-10-10 · Windows 通用设置：可信保存与生效说明
- 归属：SHIP_PLAN G2；有限 UIUX 步骤 2/4，完成后主线程再冻结完整候选；本 PR 不构建或推进更新源。
- 来源：main [b9922d78](https://github.com/raydocs/tono/commit/b9922d78217e7032bd15b7e2c26e176b1f756ad6) → `amp/settings-flow-consistency`，本 PR；#1546/#1547 已合的隐私反馈保留，不重复实现。
- 缺陷修复：`WIN-GENERAL-UNCONFIRMED`：通用设置读取未完成时允许写入、开机自启提前显示选择、语言先切界面再保存；失败只能弹消息并猜测回滚。改为禁用读取/写入中的控件，等待原生 setter 成功和实际读回匹配后确认；失败跨页面保留不确定状态，必须成功重读才可继续。所有通用选项共享同一原生偏好文档，操作锁覆盖导航、读回及语言资源应用。
- 新增/优化：说明 Windows 登录时打开、界面语言即时生效及无需重连/重启；不把 Mac 语言重开/释放保护行为伪装成一致。说明字号与外观卡一致，窄行允许换行，分段控件使用真正 disabled；错误详情折叠，恢复操作可键盘访问。
- 工程与测试：现有 preferences hook 返回实际读回结果，不忽略 SWR 读回错误；预览改用生产 hook 和共享合成 IO，而非假成功 no-op。新增一条公开设置组件回归，覆盖读取、迟到失败、导航、读取不同实际值、语言保存完成前不切换。
- 验证：旧行为回归先失败 `expected false to be true`（读取中开关未禁用）；改后 Linux orb `vitest run settings.test.tsx SeaControls.test.tsx AppearanceCard.test.tsx --maxWorkers=1`：3 files / 6 tests passed，`tsc --noEmit`、触及 TS 文件 ESLint exit0，Biome `Checked 8 files in 14ms. No fixes applied.` 首次 lint 的两处无用导入已由 ESLint 修复，未放宽检查；截图与最终 CI 在同 PR 续记。
- 候选/发布：仅源码，无新包、无更新源变化；原生 setters/defaults、首页/连接页、transport、PF/WFP/helper 权限未改。
- 剩余限制：Linux Chromium + 合成 IO 不是 Windows 原生 WebView2/登录项/磁盘故障或完整包验收。Mac 通用设置另一个独立 PR，不碰 #1506 的局域网权限或底层保护逻辑；两端完整系统体验和原生输入/字体/DPI 留最后候选包验收，不自评分。
