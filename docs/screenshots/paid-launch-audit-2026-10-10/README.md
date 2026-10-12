# 付费上线审计：首登隐私告知的原始窗口证据

`login-native-window.png` 是 GitHub [macOS CI 38090719777](https://github.com/raydocs/tono/actions/runs/38090719777)
的 [artifact 11683498862](https://github.com/raydocs/tono/actions/runs/38090719777/artifacts/11683498862)
中 `renders/login-sea-email-native-window.png` 的逐字节副本，未裁切、重绘、缩放或后期排版。

- 捕获源码：[dfb06df79551653992d6793348f33c59c32d10b9](https://github.com/raydocs/tono/commit/dfb06df79551653992d6793348f33c59c32d10b9)。
- 本审计基线：[a6ef4580fe3a890338ad2f9a1ae786c3318c31a0](https://github.com/raydocs/tono/commit/a6ef4580fe3a890338ad2f9a1ae786c3318c31a0)；
  `git diff dfb06df7..a6ef4580 -- apps/macos` 为空，图片所指文案仍在该基线上。
- SHA-256：`b343cfd54382120eb25a4a52903301c652d1423bee4f9caf6fe17fed11d3b2b0`。
- hosted macOS AppKit 窗口、生产 SwiftUI、合成账户/状态；不是签名真机、国内网络或实际 PF/上传证据。
- 只证明 opt-in 承诺实际可见。默认上传的矛盾由当前源码与决定076交叉确认，见[报告](../../reports/PAID_LAUNCH_AUDIT_2026-10-10.md)。
- Issue [#1556](https://github.com/raydocs/tono/issues/1556)，规范 ID `LOGIN-LOG-UPLOAD-COPY` 与两端修复由
  [#1557](https://github.com/raydocs/tono/pull/1557) 维护；**本图是修前证据，不是修后新捕获或已关闭回执**。

本目录仅保留这一张已实际查看的原始 PNG，不含下载 ZIP、安装包、缓存、测试结果包、凭据或用户日志。
