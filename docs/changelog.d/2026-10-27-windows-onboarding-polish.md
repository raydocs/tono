## 2026-10-27 · Windows 海面外观引导与登录体验打磨
- 归属：G1（客户路径 UI 打磨；仅 Windows 海面外观的欢迎页与登录页）。
- 来源：基线 main 316d065；分支 `amp/windows-onboarding-polish`；未合 main。
- 缺陷修复：
  - 英文登录在「已发送」状态时，按钮里的 "Request sent" 会折成两行，现在保持一行显示（`.sea-login .tono-progress-pill` 加 `white-space: nowrap`）。
  - 欢迎页第 3 屏多出「线路由 Tono 推荐」标签后，主按钮和分页点会往下跳；现在标签放在按钮下面，三屏的主按钮位置一致。
- 新增/优化：
  - 欢迎页：分页改为顶部分段进度条（当前段拉长，看过的段为暖色），旁边显示「n / 3」，「跳过」挪到同一行右侧；第 2、3 屏加「上一步」（新增 `tono.seaIntro.back`，只加 en/zh）；
    文案按前进/后退方向滑入；中文标题按词断行（`word-break: keep-all` + `text-wrap: balance`），不再出现「查收验 / 证码」这样的断法。
  - 登录验证码步骤：邮箱地址（胶囊样式）与「换邮箱」、垃圾箱提示和发件人移到说明文字下方、验证码格上方，
    用户先确认验证码发到了哪里再输入；之前这几项排在卡片底部，而且居中对齐。标题和卡片在切换步骤时有 240ms 淡入。
  - 所有新动效都遵守 `prefers-reduced-motion`。旧（classic）外观、连接流程、SeaScene 渲染和性能都没有改。
- 工程与测试：`intro.test.tsx` 的海面用例加上「上一步」回到上一屏的断言（旧代码上会红：找不到名为 "Back" 的按钮）。
- 验证（Linux orb，Node 22）：`vitest run` intro / login / login-support / _layout，共 5 个文件 48 个用例，全部通过；`tsc --noEmit` 通过；改动文件的 eslint 和 biome format 通过。
  截图与录屏来自 Windows 预览壳（`vite.shell-preview.config.mts`，模拟数据，Linux Chromium，替代字体，不是真机）。
- 候选/发布：只改源码，没有出新候选包。
- 剩余限制：没有在 Windows 真机上看过（DPI、Microsoft YaHei UI 字体、WebView2）；macOS/iOS/Android 的引导没有改（#1724 正在改 macOS 引导的保护范围文案）。属于 UI PR，按 AGENTS.md 等所有者看图后再合，不开 auto-merge。
