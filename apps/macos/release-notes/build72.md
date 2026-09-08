# Tono macOS 0.0.72（build 72）

- 改善连接恢复、诊断和配置校验；不可用的必需家宽出口不会悄悄回退为云出口。
- 补齐 Claude 相关支付与验证依赖的家宽链式分流，包括 Stripe、Link、hCaptcha 和 Statsig，按目标域名匹配，不依赖特定浏览器。
- Helper 更新至 3.15.0，整理连接保护边界，并修复发布签名缺失安全时间戳的问题。
- Windows 与 macOS 源码版本统一为 0.0.72，两平台安装包独立验收发布。

## 验证范围与已知限制

源码单元测试、策略测试及 CI 特权测试已通过。发布仍要求对实际安装包验证 Developer ID、Apple 公证、Sparkle 签名和特权 Helper 安装；CI 通过不代替实机连接测试。

- [#17](https://github.com/raydocs/tono/issues/17)：未覆盖全部浏览器 Secure DNS、银行 3DS 和登录后支付场景，不承诺所有流量均已逐一验收。
- [#26](https://github.com/raydocs/tono/issues/26)：完整受保护自动更新生命周期仍单独跟踪。手动安装请先正常断开连接并退出 Tono；不推进尚未完成升级链路验收的自动更新频道。
- [#4](https://github.com/raydocs/tono/issues/4)、[#5](https://github.com/raydocs/tono/issues/5)：计量切换与计数器代际限制单独跟踪，本次桌面发布不执行生产计量迁移。
