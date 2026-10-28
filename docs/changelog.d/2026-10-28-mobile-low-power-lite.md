## 2026-10-28 · iOS / Android：低电量时海景改用 Lite（停装饰循环，保留状态提示）
- 归属：ops 计划外的移动端测试客户端（不属 SHIP_PLAN 门；iOS / Android 不在本发范围）；`apps/ios/App/Views`、`apps/android/mobile` UI、TonoKit `SeaMotion`。
- 来源：`main` 4e24e50a7 → 分支 `amp/mobile-low-power-lite`；未合 main。视觉行为经所有者同意（2026-10-28，经编排线程 T-01a17c78 转达）；同意视觉方案不是发布授权。
- 新增/优化：iOS 低电量模式、Android 省电模式下，星光闪烁、漂移、太阳呼吸光晕与倒影波纹停在当前位置；离开后从停住处继续（两个方向都不跳）。状态之间的天空过渡与 iOS 重连扫光保留；减弱动态优先，仍全部静止。无新设置；iOS 跟随 `NSProcessInfoPowerStateDidChange`，Android 跟随 `ACTION_POWER_SAVE_MODE_CHANGED`，切换即时生效。规则在 iOS `SeaMotion`（TonoKit）与 Android `SeaMotion` 各一份，与 macOS Lite 一致。
- 保留行为：隧道、kill switch、路由与状态文字不变；登录/引导页不改，只改 `SeaScene` 本身。
- 验证：见 PR 验证评论；新增 iOS 模拟器 Lite 性能采样（代理指标）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未在 iPhone / Android 真机测能耗，不声称省电；合并前需至少一次真机读数（Instruments Energy Log 或 Android Battery Historian / dumpsys gfxinfo）。
