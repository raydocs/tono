| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ANDROID-LEGACY-NETWORK-PERMISSION | Android 10/11 网络监控缺少正常权限，旧系统创建 VPN service 时抛异常 | open | 待开 | 高·已确认（API29） | API29 云端已复现；API30 同分支源码推导；修复 GREEN、独立审查和真机验证待补，未合 main/发布 |

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
