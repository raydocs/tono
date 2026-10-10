## 2026-10-10 · 首登页如实告知流量日志默认上传
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G2（首登体验）；发现 [LOGIN-LOG-UPLOAD-COPY](../findings.d/LOGIN-LOG-UPLOAD-COPY.md)；决定 [076](../decisions/076-2026-10-08-raw-network-logs-stored-by-default.md) 不变。
- 来源：分支 `amp/login-log-upload-disclosure`，基线 origin/main `a6ef4580`。
- 缺陷修复：macOS `LoginView` 与 Windows 登录页的隐私一句原写"流量日志不会上传，除非你在设置里打开"，与新安装默认开启上传相反。
  改为（中/英同义）："邮箱只用于登录。流量日志默认上传：你连接的主机名、发起每条连接的应用、命中的规则与路由，用于排查问题。可在设置里关闭。"
  涉及 `LoginView.swift`、`Localizable.xcstrings`、Windows `locales/{en,zh}/tono.json`、`login.test.tsx` 的文案断言、`docs/welcome-v2.md`。
- 不改：上传默认值、上传内容、设置页开关与说明、服务端保存期限。
- 验证：Windows `npx vitest run src/pages/tono/login.test.tsx` 14 通过（Linux）；macOS 仅文案与字符串表，`xcstrings` JSON 校验通过，构建由托管 CI 运行。未重拍截图。
- 候选/发布：仅源码，无新候选。
- 续记（2026-10-10，合并 main `5b132844`（#1554）后）：并入 #1554 的 Sol M1 minor：Windows 登录页保护提示（`networkBlocked.description`、
  `unverifiedDescription`，中英）原写"可以通过 Tono 中继登录"，而已武装、无 revision-20 中继放行的旧 Service 仍走完整路径；改为不提路线的
  "你仍可登录 / 你仍可获取登录验证码，无需关闭保护"。`login.test.tsx` 改为断言该提示不提中继。中继失败标记专用的错误与详情不变。
  `npx vitest run src/pages/tono/` 14 文件 192 通过（Linux）。
