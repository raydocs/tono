## 2026-10-01 · Windows 默认核改为 sing-box

- 归属：SHIP_PLAN G1（已连接=能用）；影响 Windows 连接与 Service 协议 18。
- 来源：main `520294ad`；分支 `cursor/win-singbox-default-select-b23a`；未合 main。不关闭 #203。
- 缺陷修复：无。
- 新增/优化：未写偏好、损坏或别人的记录默认 sing-box。本机 schema 2 `core: mihomo` 或 schema 1 `sing_box_core: false` 才用 mihomo。二进制缺失或摘要对不上，且 WFP 尚未武装时，才自动回退 mihomo。武装之后不换核。Service 低于 18 时不把已认证的 sing-box 偷偷换成 mihomo。sing-box 用 `config.json` 和 `run -c`，摘要是 `TONO_SING_BOX_SHA256` / `sing-box-sha256.txt`，不跟 mihomo 的 pin 混用。TUN 不写 `stack`（alpha.9 sing-tun 发送 2 MiB、接收 4 MiB，不是 JSON 字段）。备用 DoH 在主用 NOERROR 之后才查，不竞赛。数据面证明后建议性 `/delay` 再等 1500 ms。选中的 HY2 没有 SPKI 则编译失败；未选中的只记为不可用，不从 DER 推导 SPKI。
- 工程与测试：`missing_file_selects_sing_box`、`automatic_mihomo_only_before_arm_on_a_missing_or_unauthenticated_binary`、`sing_box_launch_args_are_run_c_and_mihomo_keeps_its_flags`、`advisory_exit_probe_waits_until_the_first_page_can_start`、`a_malformed_hy2_spki_pin_is_rejected_and_never_derived`。既有 DoH 与 fake-ip 测试补了不竞赛、不写 stack。
- 验证：本机 rustc 1.83 不能编译 edition 2024，`cargo test` 未执行。Windows CI 是门禁。
- 候选/发布：仅源码，无新候选。
- 剩余限制：needs-hardware。sing-box 的 DIRECT 仍保持已证明的全隧道，因为 alpha.9 的 `PUT /configs` 不是重载，进了重载括号再失败会把流量留在 Blocked。安装包还没有把 `sing-box.exe` 放进三二进制替换事务；镜像缺失时连接前会回退 mihomo。实机请用备用机，先做备份。
