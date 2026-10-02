| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-BANNER-STALE-ACTION-ERROR | Windows「受保护离线」横幅里重试或备用通道失败的错误不会清掉，连接恢复后下一次离线时横幅又显示上一次的旧错误 | in-PR | [#1348](https://github.com/raydocs/tono/pull/1348) | 低·推导 | 只影响横幅的提示，不影响连接和保护；回到主页（横幅收起）也会清掉这条错误，主页的进度卡有自己的错误显示；未在 Windows 实机上复现 |

依据：`apps/windows/app/src/tono-ui/ProtectedOfflineBanner.tsx` 的横幅为了高度动画一直挂在布局里，`actionError` 只在下一次点「重试」或「备用通道」时才清空。一次离线里重试失败留下的错误（例如 Service 未就绪）在连接恢复、横幅收起后仍留在组件状态里，之后再次进入受保护离线时横幅直接带着这条和当前情况无关的旧错误出现。2026-10-02 读代码发现。
