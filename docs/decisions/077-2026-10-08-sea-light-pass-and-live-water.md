## 2026-10-08 · 海面光线升级、实时水面、流量驱动碎光
- Status: owner
- Chosen: 老板 2026-10-08 看完前后对比与 WebGL 水面小样（https://claude.ai/artifact/V5YWQFJM1xipfvs8yfsopa）后的原话「1进 2 实时渲染可以好看就行 3 保留」。(1) 首页日出场景的光线升级进 App：天顶加冷蓝灰、太阳去掉亮边圈换成过曝中心和柔和外晕、光晕放宽、地平线薄雾、颗粒不盖太阳、红日时中心随之收掉；布局、几何、时序、文字不动。(2) 水面在「完整画质」下改为实时渲染（Windows WebGL，Mac Metal），好看为准；CSS / 图层场景保留给省电、低配、减少动态效果和渲染失败。(3) 水面碎光随实时流量变化，保留，幅度压低。
- Rejected: 继续用 CSS 贴图水面作为唯一实现；用 imgen 照片做背景（10-08 已否决）。
- Why stricter: 只是装饰层；不读、不发任何新数据（流量取自首页已有的流量订阅，不新开连接），不改连接状态、保护判断或任何文字；实时水面只在完整画质且窗口可见时运行，任何失败都退回原 CSS 水面。
- Applied in: Windows PR `claude/sea-light-water-20261008`；Mac PR `claude/macos-sea-light-water-20261008`。
