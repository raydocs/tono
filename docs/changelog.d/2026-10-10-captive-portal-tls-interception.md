## 2026-10-10 · 两端识别强制门户与 TLS 拦截，失败归因写明并进诊断报告（H21-O-F8）
- 归属：ops 任务（[运维计划](../ops/plan-2026-09-11.md)，[Amp backlog](../ops/amp-backlog-2026-10-10.md) A11）；macOS App、Windows App 与 tono-core、控制面诊断入口。
- 来源：origin/main `2e4a7dfc`（初版基于 `6b52b07a`，因 #1484 拆分 worker 测试而 rebase）→ 分支 `amp/a11-captive-portal-attribution`，[#1488](https://github.com/raydocs/tono/pull/1488)；未合 main。
- 缺陷修复：网络要求网页登录（强制门户）或中间设备/本机安全软件替换了 Tono 服务器证书时，登录与目录刷新只显示通用的「无法连接 Tono」/
  「登录没有完成」，诊断报告也看不出（H21-O-F8）→
  - TLS 拦截：只分类现有 TLS 栈已经给出的错误，证书校验不变、被拒的证书从不接受。macOS 新增 `NetworkInterception`：URLSession
    `NSURLErrorServerCertificateUntrusted`/`HasUnknownRoot`，以及其背后的 Secure Transport/`SecTrust` 状态（-9807/-9812/-9813/-9843、
    `errSecNotTrusted`、`errSecHostNameMismatch`；pinned 路径的 `NWError.tls`）；证书日期错误仍归时钟（#588）。控制面客户端改抛
    `APIError.tlsIntercepted`，文案「网络在拦截加密连接：……如果这个网络有网页登录，请先在浏览器里完成；否则请关闭检查 HTTPS 的代理或安全软件，然后重试。」
    多路径时只在抛出的错误上加证据键，错误码不变（重试规则不变）；pinned 路径把被拒证书记为 `trustRejected`，抛出的仍是 `cannotConnectToHost`，时序不变。
    Windows：传输层在 rustls `UnknownIssuer`/`BadSignature`/`NotValidForName(Context)`（webpki 或平台校验器的 `CERT_E_UNTRUSTEDROOT`/`CERT_E_CN_NO_MATCH`）
    错误链上加 `TONO_TLS_INTERCEPTED` 标记，错误文本只写固定类别（unknown issuer / bad signature / not valid for this host），
    不再带出 rustls 列出的证书名称（门户主机名）；tono-core 新码 `TONO_TLS_INTERCEPTED`（阶段 tls），前端新键
    `tono.login.errors.tlsIntercepted`。
  - 强制门户：Windows 控制面请求在传输层失败后读取一次系统 NLM 结论（WinRT `NetworkInformation` 的 `ConstrainedInternetAccess`，即 Windows 自己的
    NCSI 明文探测被跳转/拦截的结论；2 s 预算、单并发、读失败当作没有），或控制面回 HTTP 511 → 错误前加 `TONO_CAPTIVE_PORTAL`，沿用已有码
    `TONO_AUTH_CAPTIVE`/`TONO_CONNECT_CAPTIVE`，前端改指向新键 `tono.login.errors.captivePortal`「网络需要网页登录（强制门户）：……」（原来指向通用句）。
    时钟错误不改归因；强制门户优先于拦截。
  - 诊断报告：两端 `virtualAdapters` 带最近一次控制面交换识别到的类别 `tlsIntercepted`（macOS、Windows）或 `captivePortal`（Windows），
    任一控制面应答即清除；只上传类别，不上传门户 URL、主机名或证书内容。控制面诊断入口白名单加这两个类别。
- 新增/优化：无路由、PF/WFP、助手协议或连接决策改动；不新增任何出站探测（armed 或未 armed 都一样），NLM 只读、只在失败之后读；
  macOS 与 Windows 的离线准入照旧把它当作「收到状态行之前失败」。
- 工程与测试：tono-core `network_interference::tests::a_refused_certificate_or_an_os_captive_portal_names_the_network`；
  Windows App `commands::diagnostics::tests::a_certificate_from_an_unknown_issuer_is_named_as_interception`（hyper-rustls 形状错误链）；
  macOS `AccountSessionRequestTests.testACertificateTheTrustStoreRefusedNamesTheInterceptingNetwork`；
  前端 `tono.test.ts` `names a captive portal or an intercepted certificate wherever the transport marked it (H21-O-F8)`；
  控制面 `worker-diagnostics.test.ts` `accepts the captivePortal and tlsIntercepted classes from a client that met them (H21-O-F8)`。
  `windows` crate 加特性 `Networking_Connectivity`（同版本，Cargo.lock 不变）。
- 验证：本机 Linux：tono-core 全部 345 个单测通过（rustc 1.95 加 `--ignore-rust-version`；CI 用固定工具链）；前端 vitest
  （`tono.test.ts`、`login-support.test.tsx`、`dashboard.test.tsx`）、eslint、tsc 通过；`generate-i18n-keys.mjs` 只多出两个新键；控制面
  `test/worker-diagnostics.test.ts`（rebase 后）19 个全部通过、typecheck 通过。未在本机运行：Swift/XCTest、Windows Tauri crate 的编译、clippy 与测试，交由托管 CI（ci-gate）。
- 候选/发布：仅源码，无新候选。部署顺序：带本改动的客户端发布前，控制面须已部署（旧入口会以 400 拒绝含新类别的诊断上传）。
- 剩余限制：未实机。macOS 没有公开的强制门户信号，Tono 也没有明文探测，所以 macOS 不单独报强制门户：为 Tono 主机名出示自己证书的门户
  按拦截报告，文案包含「先完成网页登录」。Windows 的 NLM 结论可能滞后于网络变化；armed 时 WFP 拦住 NCSI 探测，NLM 只会报「无 Internet」，
  不会误报门户。被系统信任（例如企业安装了根证书）的拦截代理不会被识别，这是设计（不做证书固定）。macOS 错误文本由系统给出，
  诊断报告只带分类码，不带原文。
