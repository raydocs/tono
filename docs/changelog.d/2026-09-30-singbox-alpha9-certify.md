## 2026-09-30 · 认证 sing-box v1.15.0-alpha.9 的三份构建
- 归属：ops 计划（sing-box 分阶段，不是客户发布门）；影响 `tooling/scripts/sing-box`。不改 macOS 安装针、不改 Windows 连接路径。
- 来源：基线 `d2363002`；分支 `cursor/singbox-alpha9-certify-01d4`；未合 main。上游标签 `v1.15.0-alpha.9` 即提交 `132b38e9caaba1a1959354d518e54d2d08419afe`。
- 缺陷修复：无。
- 新增/优化：无客户行为。`certify.py` 增加可选 `--candidate`，默认仍是冻结的 M0 alpha.3 候选。alpha.9 候选单独记录 Go 1.27.1、四个构建标签、`sing-tun v0.9.6-0.20260925112405-97d11460f2ea` 和横幅 `1.15.0-alpha.9-tono-a9.1`。
- 工程与测试：提交 linux-amd64-v2、darwin-arm64、windows-amd64-v2 三份清单。CI 在 Linux 上重编 linux 核心，对冻结 M0 引用、macOS 产品形状和 HY2 `certificate_sha256` 形状跑 `check`。负例仍要求非法 Reality 公钥失败。
- 验证：本机 Go 1.27.1 交叉编译三目标后 `certify.py check` 退出 0；`python3 -m unittest discover -s tooling/scripts/sing-box` 通过。linux 核心 `sing-box version` 为 `1.15.0-alpha.9-tono-a9.1`。二进制 SHA-256：linux `11d7d817a3900743b8003b2e958ebebdb9bff99a8541e2c3139e2f5413811e4e`，darwin `ab0187a774e2515e7e6761e23ece0b656818cb4c31c983070b3fd023db172258`，windows `b2e6902ee75d9c4af79df28a61ded67afc4283fc83a44dee8896f3737a4ed027`。
- 候选/发布：仅源码和清单，无客户包。这些二进制未签名、未安装。
- 剩余限制：macOS 安装针仍是 alpha.3，要等单独的针脚 PR，并在 Mac Studio 上浸泡后才能当发布候选。Windows 实机未跑。`release.json` 仍锁着 alpha.3，避免把未浸泡的核心写成当前选定身份。

## 2026-09-30 · 续记：check 的产品形状带上第二条 DoH
- 归属：同上。只改认证夹具，不改 M0 `reference.json`。
- 来源：PERF-CONNECT-4。夹具现在是 `198.18.16.0/20`、`rewrite_ttl` 30、顺序的第二条 https DoH、`alpn` 只有 h2。
- 验证：用已编好的 linux alpha.9 核心对两份夹具跑 `sing-box check`。
- 剩余限制：夹具不是 Swift 发出器的字节。发出器在单独的 PR。M0 引用仍是 `198.19.0.0/16` 和一个 DoH。
