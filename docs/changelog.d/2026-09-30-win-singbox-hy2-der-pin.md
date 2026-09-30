## 2026-09-30 · Windows sing-box 路径写出 HY2 DER 钉并收紧 fake-IP
- 归属：ops 计划（sing-box 分阶段，不是客户发布门）；影响 `tono-core` 的 sing-box 编译器和 `runtime-template.json`。不改正在使用的 mihomo 连接路径。
- 来源：基线 `d2363002`；分支 `cursor/singbox-hy2-der-pin-01d4`；未合 main。
- 缺陷修复：无（客户仍跑 mihomo）。
- 新增/优化：已准入的 64 位十六进制叶子 DER 指纹写成 sing-box `certificate_sha256`（32 字节的标准 base64）。钉不是 32 字节就整份配置失败，不删字段、不写 `insecure`、不改成 SPKI。未选中的 HY2 同样带钉发出。sing-box 产品模板的 fake-IP 改为 `198.18.16.0/20`，落在 Windows 探测所用的 198.18/16 内、TUN `/30` 外。mihomo 的 `198.18.0.1/16` 不变。
- 工程与测试：更新 HY2 拒绝测试为钉必须出现；新增 fake-IP 区间测试和 mihomo YAML 摘要测试。
- 验证：Linux 上 `cargo test -p tono-core --lib sing_box::runtime`。Windows 实机与 macOS XCTest 未运行。
- 候选/发布：仅源码，无新候选。Service 尚未加载这份 JSON。
- 剩余限制：开关默认关闭。错钉在链路上失败关闭要等实机；本机只证明配置里钉不会被拿掉。macOS Swift 仍用 198.19 和 SPKI，本 PR 不改它。
