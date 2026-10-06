## 2026-10-06 · Windows 新外观 PR 10：品牌资产图稿
- 归属：`docs/SHIP_PLAN.md` 0.0.75 UI，ROUND-3 §12；stacked on #1412，未合 main。
- 来源：`33945d5b` → 本 PR head；`codex/windows-ui-pr10-20261006`。
- 缺陷修复：无；不是运行时或安装故障修复。
- 新增/优化：dev-only日出/海平线mark、16/24/32/48/64/128/256像素SVG/PNG、七尺寸RGBA ICO、150×57安装器header/164×314side SVG/PNG/BMP24、bar lockup、#0B0A12初始splash；一张审批sheet同时展示浅/深底1×应用图标、安装器位置示意和PR7托盘四态。
- 工程与测试：Node单回归检查ICO目录范围/原PNG字节/各尺寸、SVG viewBox、BMP24与源尺寸及原installerIcon配置，纳入现有Windows CI test:dev-control。仅格式转换和Dev素材，无production品牌路径、NSIS模板、权限、连接或信任策略修改。
- 验证：EgoTaskSpace23实际DPR1与十张图标natural/CSS尺寸一致，无水平溢出；完整sheet/256图标已目视检查。PNG七尺寸RGBA/alpha0..255/透明角；BMP尺寸正确；raw Node tests1/pass1/fail0；完整Node脚本raw tests123/pass123/fail0；CI结果待PR comment。
- 工程续记：pnpm自动安装触发内部API非预期2.12.1锁文件解析；只撤销该命令自身变化并用frozen-lockfile还原依赖，lockfile diff为零，没有依赖升级混入本PR。
- 候选/发布：仅源码图稿；未打包、签名、安装或客户发布。旧runtime app/tray/installer图标原样保留。
- 剩余限制：owner尚未批准图稿，已展示并询问；批准前不接线。Installer画面是只读位置示意，不是原生NSIS截图，DPI/CJK/真实decode/SmartScreen/安装流程未验证。全部十个UI PR“有源码/草稿”不等于已完成所有验收或可以发布。
