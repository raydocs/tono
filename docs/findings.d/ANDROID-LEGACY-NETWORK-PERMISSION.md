| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ANDROID-LEGACY-NETWORK-PERMISSION | Android 10/11 网络监控缺少正常权限，旧系统创建 VPN service 时抛异常 | fixed(f8b673518) | [#1726](https://github.com/raydocs/tono/pull/1726) | 高·已确认（API29/30） | API29/30 云端行为 RED；修复 API29/30/34 GREEN，独立审查及交付 head 的 ci-gate/android-ci 通过；待真机、其他 API 层与发布资格 |

2026-10-23，通用 Android 审计 F1。冻结产品基线 `0465af814`，仅增加回归的
`4fbf1e6a4b387c80498e14975595791591839ee6` 在
[Devin 云端会话](https://app.devin.ai/sessions/e8291010a8af4c30937075dd4faca3eb) 复现。

- merged debug manifest 和 APK 均无 `CHANGE_NETWORK_STATE`，不是只看源 manifest 的推论。
- API29 新回归确实执行 1 次、失败 1 次：`SecurityException ... CHANGE_NETWORK_STATE, WRITE_SETTINGS`，
  调用栈为生产 `NetworkMonitor.start:56` → `ConnectivityManager.requestNetwork`。
  未登录的真实 MainActivity 绑定引擎也导致 `:vpn` 进程 `Unable to create service` 崩溃。
- 同一 APK 在 API34 的同一方法输出 `OK (1 test)`；首次 API34 环境没有网络，重建同 API
  模拟器后才运行测试，环境重试不计作产品测试通过。
- RED APK SHA256：`e79283289cc2756b1a5457c5e5ff018b19d85eb92d9627a90002eeaaca78b3c1`。
  instrumentation APK：`b0753ac75140a4e36c7c8c9e8957bff25914ea282c042dae00afaca8e36d00fe`。
- 修复仅声明 `CHANGE_NETWORK_STATE` 正常安装权限；不请求特殊 `WRITE_SETTINGS`，不手动 grant，
  不绕过 VPN consent，不吞掉异常伪报已连接，不改网络选择、路由或保护状态。
- 一个真实平台回归等待非 VPN INTERNET 上行回调；将该方法加入现有 API34 CI system shard。
  API29/30 专项在 Devin 执行，持续 CI 版本矩阵缺口保留，不擅自把 Android 加进 `ci-gate`。
- 原始证据：云会话附件 `api29-instrumentation.log`、`api34-instrumentation.log`、
  `api29-signedout-service-reproduction.log`、`apk-permission-inspection.log`。没有真实手机或发布包验收。

修复验证：同会话固定 `8a3ba2cc7db6a305aa96a3ef65646c951a7b474c`，API29/30/34 各执行
同一个回归，均 `OK (1 test)`；各自未登录 MainActivity → service 创建无原权限崩溃，未宣称已连接。
API30 先安装原 RED APK：`Tests run: 1, Failures: 1` 且相同 `SecurityException`。
GREEN app APK SHA256 `0209e7078f24151c1a97bd5127d7c9755c78e28b545f225ed5e04f9dbf3f02fd`；
instrumentation APK 与 RED 字节相同。routing JVM：18 passed；mobile：102 passed、25 默认 opt-in skips，
0 failures/errors；lint 通过。API30 首次云端网络预检有一次环境重试，所有固定 APK 回归均一次通过。
独立 Sol/xhigh 审查覆盖上述 SHA，无 finding；原始附件 `api{29,30,34}-green-instrumentation.log`、
`api30-red-instrumentation.log`、`routing-unit.log`、`mobile-unit.log`、`mobile-lint.log` 已由父任务读取。

2026-10-23 合入状态复核：#1726 已合 main，合并提交 `f8b673518`；GitHub PR 状态、精确交付 head CI 及 main ancestry 已核对。此状态只确认源码合入；上文初次实现/夹具的待验证说明保留为历史，不替代后续运行证据，也不代表实机或客户发布通过。
