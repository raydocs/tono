## 2026-09-26 · macOS hy2 用目录单独发布的 SPKI 钉扎接入 sing-box
- 归属：G2（连不上有下一手），0.0.74 发布阻断；所有者决定 2026-09-26「本版 hy2 对所有用户可用，含 macOS」
  （[DECISIONS](../DECISIONS.md)）。影响 macOS App（`ConfigParser`、`ProxyNode`、`ConfigPipeline+Nodes`、
  `ConfigPipeline+SingBoxProduct`）、控制面目录合同（`catalog-yaml.ts`）、sing-box 产品合同。Windows、Helper、PF、协议未改。
- 来源：基线 origin/main `cbe1b5a7`；红分支 `wip/macos-hy2-spki-pin-red`（`277bb163`，只含测试），修复分支
  `feat/macos-hy2-spki-pin-20260926`；未合 main。
- 缺陷修复：macOS 0.0.74 的 sing-box 1.15.0-alpha.3 只支持 `tls.certificate_public_key_sha256`（SPKI 的 base64 SHA-256），
  目录 hy2 块只有叶证书 DER 的 SHA-256（`fingerprint`，mihomo 语义），所以每个 hy2 节点都标为
  `TONO_SINGBOX_HY2_DER_PIN_UNSUPPORTED`，macOS 没有可用的备用通道。现在 hy2 块可另带 `certificate-public-key-sha256`
  （运维在节点上从同一证书算出，32 字节标准 base64）；带合法值时 macOS 生成
  `tls: {enabled, server_name: <sni>, certificate_public_key_sha256: [<pin>]}`，节点可选、进「试用备用通道」和路线推荐
  （这些入口本来就按 `singBoxUnavailableReason` 过滤，不需另改）。不带或格式不对仍按原理由不可用，客户端从不由 DER 推 SPKI，
  从不写 `insecure`。DER `fingerprint` 仍是准入必需项（Windows/mihomo 继续用它）。TCP 失败不自动切到 hy2（未改）。
- 新增/优化：控制面接受 hysteria2 块上的可选 `certificate-public-key-sha256`：只能一行 block 写法、值为 32 字节的规范
  base64，否则按与其它坏块相同的路径拒绝（`INVALID_CATALOG`）；VLESS 块不得带。不许 flow 写法的原因：早于本改动的
  macOS 解析器把未知 flow 键并进前一个值，会拒绝整份目录。发布脚本 `publish-managed-catalog.rb` 不校验该键，原样保留。
- 工程与测试：XCTest `testHY2WithPublishedSPKIPinGetsPinnedSingBoxOutbound`（经生产目录解析器读该键，断言钉扎出站与 UDP 拨号端点）；
  `testProductRuntimePreservesHomeDirectAndRejectsHY2WithoutSPKIPin`（原测试改名，加一个带钉扎的兄弟块，只有无钉扎块不可用；
  其产出的运行时字节由 CI 用固定 sing-box `check` 与 `tono-core-helper --runtime-contract-check` 校验）；vitest
  `admits an optional block-style SPKI pin of exactly 32 bytes on hysteria2 blocks only`；Ruby
  `test_publish_keeps_the_hy2_spki_pin_beside_the_der_fingerprint`（现有代码已通过，只作守护）。
- 验证：本地 `services/control-plane` `vitest run test/catalog-yaml.test.ts` 修复前 1 败（31 字节值未被拒），修复后 3 过；
  全量 `vitest run` 43 文件 932 过；`tsc --noEmit` 过。Ruby 新测试本地过。本地用 openssl 按 `manage-tono-hy2-node.sh`
  的方式签 P-256 证书，下面的 openssl 命令与 Go `x509.MarshalPKIXPublicKey` 的 SHA-256（sing-box `VerifyPublicKeySHA256`
  的算法）结果相同。macOS 未在本机构建或测试；红分支与修复分支的 hosted macOS CI run 编号与结果记在 PR。
- 候选/发布：仅源码，无新候选。已有 0.0.74 kit 不含本改动。
- 剩余限制：生产目录还没有任何 `certificate-public-key-sha256`，在运维逐节点发布之前 macOS 仍无可用 hy2。运维命令
  （在节点上，证书路径取 hy2 配置 `tls.cert` 实际指向的文件，脚本装的节点是 `/opt/tono-hy2/current/cert.pem`）：
  `openssl x509 -in /opt/tono-hy2/tls/cert.pem -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64`。
  hy2 对所有用户可见还取决于生产 `HY2_CATALOG_EMAILS`：设了值就只有名单内账号收到 hy2 块（`catalog.ts` 剥离逻辑未改）。
  Rust sing-box 发射器不读该键。
  未实机连接 hy2。
- 续记 2026-09-26（审查 ce2768d6：opus:F1 与 codex:F1 同根的两个 minor 加一条建议，按停止规则只修一轮）：
  - 缺陷修复：控制面放行的钉扎写法比 macOS 解析器宽。`catalogScalar` 会剥掉行尾 `# 注释`，行正则也不限缩进层级；
    macOS `cleanYAMLScalar` 把注释留在值里，嵌在子键下的键又挂在父路径下读不到。这两种写法都能发布成功，但 macOS
    把钉扎当作缺失，节点悄悄保持不可用。现在控制面只接受 macOS 读得到的那一种写法：键在该条目自身字段那一列
    （`- name:` 下面字段的列），值为裸写或成对引号，行尾不能有注释，后面也不能有更深缩进的续行。其它写法一律
    `INVALID_CATALOG`。
  - 新增/优化（建议）：`manage-tono-hy2-node.sh apply` 每次签发新证书时，用同一条 openssl 管道算 SPKI 钉扎，
    JSON 输出里在 `fingerprint` 旁边多一个 `certificatePublicKeySha256`，重跑脚本就不会留下过期的 SPKI 钉扎。
    `provision-reality-node.rb` 还不会把它写进目录源文件（未改）。
  - 工程与测试：vitest `rejects an SPKI pin with a trailing comment, which macOS reads as part of the value` 与
    `rejects an SPKI pin nested under another key, which macOS never reads`。红分支 `wip/macos-hy2-spki-pin-red2`
    （`a902b3a9`，基于 PR 头 `4e5e65f5`，只含测试）。
  - 验证：在本地基于 `4e5e65f5` 的代码跑，两个新测试都按断言失败（`expected INVALID_CATALOG`），修复后 5 个全过；
    全量 vitest 与 `tsc --noEmit` 见 PR。另用一次性探针（未提交）确认：裸值、双引号、单引号、尾随空格照样接受；
    续行、缩进错位、冒号后无空格、引号不成对都拒绝。节点脚本只跑了 `bash -n` / `sh -n`，没有在节点上执行。
    托管 CI 的 run 编号记在 PR。
