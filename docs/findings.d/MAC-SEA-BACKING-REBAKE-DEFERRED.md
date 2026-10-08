| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-SEA-BACKING-REBAKE-DEFERRED | 屏幕像素密度变化只经布局去抖排队，原贴图可能延迟保持旧分辨率 | fixed(ee22990a5) | [#1440](https://github.com/raydocs/tono/pull/1440) | 低·推导（CI 夹具失败已确认） | backing 通知在 scale 变化时立即重烘焙，尺寸拖拽仍去抖；原像素断言保持且取消对调度器 300ms 的依赖。CI37694685899 原测试四断言失败，已合 main ee22990a5（#1440，ci-gate 绿）；真屏幕切换未实机。 |

643 tests / 1 skipped / 4 failures 都在 testBackingScaleChangeRebakesContentsAtUnchangedPointSize（tree不换、scale1非2、grain scale1非2、320非640）；同次 resize-origin 窄回归通过。原始问题未以真实装机/显示器迁移复现，不称为全机保护或连接缺陷。
