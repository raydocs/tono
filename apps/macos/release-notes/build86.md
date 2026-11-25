# Tono 0.0.85 (build 86)

Requires Apple Silicon and macOS 26.3+.

## Changes since build 85

- **Expanded China direct routing & LAN access** (#1850): Added domestic direct coverage including `.cn`, ToDesk, `assetcloud.zj.gov.cn`, Gitee, Jimeng (`jimeng.jianying.com`), and Aliyun Wanwang (`wanwang.aliyun.com`), moved mainland `dashscope.aliyuncs.com` back to direct, and enabled local LAN device access by default on macOS.
- **Zero-downtime policy key rotation & read fallback** (#1851): Rotated the production `traffic-policy` Ed25519 signing key while keeping legacy signature verification fallback for older cached revisions.
- **Per-site bandwidth & stall telemetry** (#1851): Records closed TCP/UDP byte totals, flow durations, and stalled zero-download TCP attempts to power global site quality monitoring in Ops Console.
