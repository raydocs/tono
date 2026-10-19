# Android #1673 · 验证环境改为 Devin Cloud

## 2026-10-19 owner 决定（取代此前本机安装请求）

不再在本机安装任何模拟器、运行时、系统镜像或 Libbox。此前要求 owner 安装 Android
组件的清单和等待安装的流程全部作废。历史只读核对显示 Homebrew JDK17 已存在；没有安装
过 Emulator/镜像/AVD/Libbox。430 KB 的临时 JUnit 测试依赖不是 SDK 或系统安装。

## 当前验证顺序

1. 未验证改动只提交/推送 `wip/android-state-authority`，不推 PR #1673 的分支。
2. 通过 `~/.agents/skills/devin-cloud/scripts/devin_cloud.py verify --platform android`，
   在已准备好的 Linux KVM Android 快照上检出精确 commit。检查清单存仓库外
   `~/.local/state/devin-cloud/briefs/`；会话 ID、URL、SHA 和结果另留验证报告。
3. 首轮运行正式 Gradle 编译、mobile/routing 全部单元测试、故障矩阵对应类和用例。
   核对原始日志/XML、每项检查、跳过原因和数量；Devin 的 pass 不是验收本身。
4. 红了由本线程修产品代码，提交同一 WIP 分支；优先 `send` 续接原会话，Devin verify-only，
   不许改产品、测试、pin，不提交、不推送、不发 PR。
5. 云端全绿后才能把已验证提交合到 `feat/android-singbox-horizon`、推送并等待 CI。
   冻结精确 SHA 后采集云端截图/录屏/无障碍证据，按原 rubric 发起两份独立盲评。

## 证据与边界

- 本机已实际执行的 46 个纯 JUnit 测试及单条 old-code red 保留在
  `2026-10-19-android-state-jvm/`；不冒充正式 Android 构建或设备验证。
- 所有新增构建/单元/UI/截图/模拟器测试改用 Devin Cloud；不跑本机 native 构建。
- 模拟器：状态故障、实际 MainActivity、通知/tile/widget、字体/旋转/可访问性语义；必须按
  真实应用/本地替身/fixture 区分，不能用测试时钟或软件 GPU 宣称真机流畅。
- 真机/签名/真实服务仍交 owner：OEM Doze/待机、锁屏恢复、通知/widget 可见首帧、真实
  网络切换、TalkBack 真人听读、GPU/帧率/发热/耗电、受控真实账号与出口。
- `needs_real_device` 合并成 owner 清单，不勾成已验证；不记录账号凭据、UUID 或 Reality key。
- Android 没有 iOS ActivityKit Live Activity，对应持续状态表面是 ongoing notification。
- 不发 release、不修改 main、不操作本机系统 VPN/代理、不进行真机或生产服务操作。
