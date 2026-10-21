## 2026-10-21 · Windows 海景在后台不再占 GPU

- 归属：客户 Windows / 0.0.75 实测（[WIN-SEA-GPU-BACKGROUND](../findings.d/WIN-SEA-GPU-BACKGROUND.md)）。Tono 在后台时，WebView2 的 GPU 进程持续占用 Intel 集显 3D 引擎（12 秒采样，平均 72%，峰值 95%）。
- 来源：分支 `fix/windows-sea-gpu-background`，基于 main `e24adbc21`。
- 缺陷修复：
  - 窗口在其他应用后面、最小化或收进托盘时，海景的循环动画、WebGL 水面和画质探测都暂停，停在当前一帧；窗口回到前台时从原处接着动。原来只在页面 `hidden` 时才暂停，而 WebView2 窗口在后台、最小化或隐藏时，页面通常仍算可见。
  - 登录页和引导页自己画一层海景，壳层背景这时透明度为 0、看不见，却一直在后台渲染第二层海景（含 WebGL 水面）。现在这两页上壳层背景保持静止，回到首页后照常运动。
- 不变：窗口在前台时，首页、内页的模糊背景、登录页和引导页的动效与画质都和原来一样；画质设置和减少动态效果的处理不变。
- 工程与测试：`SeaScene.test.tsx` 新增「失焦暂停、回焦恢复」用例，`SeaBackdrop.test.tsx` 新增「登录页背景静止、回首页恢复」用例，两条都确认在旧代码上失败。本地 `vitest run` 60 个文件 424 条全过，`pnpm typecheck` 通过。
- 验证：GPU 占用的下降还没有在 Windows 真机上测量过。
- 候选/发布：仅源码，无新候选。
