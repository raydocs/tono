## 2026-09-30 · HY2 住宅 NAT 保活与空闲支持码

- 归属：SHIP_PLAN 客户连接路径（同节点 ` · hy2`）。不影响 G4 发布。macOS sing-box 发出器、Windows sing-box 后处理、两端 mihomo 发出器、支持码。
- 来源：`main` `5c32a4b1` → 本分支；[#749](https://github.com/raydocs/tono/pull/749)；未合 main。
- 缺陷修复：无运行时故障被本条声称已在客户机器上消失。sing-box 以前不写 `keep_alive_period`，沿用 sing-quic 的 10 秒默认，短住宅 UDP 映射可能在保活丢失时先过期。
- 新增/优化：macOS 产品 JSON 的 hysteria2 出站写 `keep_alive_period: 5s`。不写 `idle_timeout`，不写 `disable_chrome_parrot`。Windows 只在已经生成的 hysteria2 出站上补同一字段；没有 DER 钉时仍拒绝该出口，不新造 HY2 代理。mihomo YAML 继续不写保活键、`handshake-timeout`、`skip-cert-verify`。QUIC 空闲文案（`no recent network activity` / `IdleTimeout` / `idle timeout`）加上 `TONO_CONNECT_HY2_IDLE`。界面向用户说明留在同一条线路上重试，不要求换节点或换网络。
- 工程与测试：`hy2_idle` 单测两条；mihomo 映射一条；macOS `Hy2IdleSupportTests` 与既有 HY2 sing-box 断言；Windows `tono.test.ts` 一条。夹具 `hy2-certificate-sha256.json` 带上 `5s`，供 alpha.9 解析检查。
- 验证：见本 PR 的工具回执。macOS XCTest 与 Windows `cargo test` 在这台 Linux 代理上不跑（无 Xcode，不安装工具链）。
- 2026-09-30 续记：macOS CI `build` 失败在 `LocalizationCoverageTests.testEverySurfaceStringHasATranslatedChineseUnit`。同一句用户文案补进 `Localizable.xcstrings` 的 zh-Hans，状态 `translated`。Windows 中文案与这句相同。不改保活字段。
- 2026-09-30 续记：线性变基到 `main` `658aed21`（#752）。`live_mihomo_yaml_stays_byte_for_byte_on_its_own_fake_ip_range` 的钉仍是 `2a0e26f477dc9aa7eab67cfa7ccbcc23b7eefd22480d60220e181a5b434ebb1c`，没有改。#729 已在 main 上发出带 DER 钉的 hysteria2，后处理给该出站写 `keep_alive_period: 5s`。
- 2026-09-30 续记：`formatTonoActionError` 会在 `TONO_CONNECT_*` 的译文后附上支持码。空闲用例的期望改成 `…hy2Idle (TONO_CONNECT_HY2_IDLE)`。不改格式化本身，也不改「不建议换线路」的断言。
- 2026-09-30 续记：`connect_bench` 在合并提交上把 `vless/clash/dns_ms` 记成 `None`（限额 30）。一次约 1ms 的 UDP `connection refused` 会让该样本缺失，五次里缺一次中位数就是 `None`，`--check` 仍把 `None` 和超限判失败。`baseline.json` 的天花板没有提高。回环 DNS 线程吞掉 Linux 在已关闭客户端上送回的 ICMP，短失败在 1 秒内重试；记入的毫秒是成功那一次自己的往返，慢失败不重试。
- 2026-10-01 续记：线性变基到当时的 `main`。`dns_query` 仍带名字参数。fake-ip、缓存命中和 DoH 复用沿用 main 的天花板，`None` 仍判失败。
- 2026-10-01 续记：`connect_bench` 上把每次约 1ms 的 DoH 失败也重试了 1 秒。无指纹的 `tono` 配置因此反复拨 Reality，伪装接受线程被占住，后面的 `tono-fixed` 和 sing-box VLESS 样本超时，`cold_ms` / `dns_ms` 变成 `None`。现在只重试直连 UDP `127.0.0.2:15353` 的 `connection refused`。出口 DoH 失败一次即记缺失。伪装握手超过 1 秒就放开接受线程，失败的尝试仍计入次数，指纹重试风暴仍会顶过握手天花板。限额不变。
- 候选/发布：仅源码，无新候选。
- 剩余限制：钉住的 mihomo 仍是内部 10 秒保活 / 30 秒空闲，没有 YAML 旋钮。Windows 产品 JSON 今天仍不发出 HY2；后处理要等 DER 钉那条合入后才作用到字节上。需要住宅 NAT 实机才能证明 5 秒是否够。
