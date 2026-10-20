## 2026-10-19 · Android 隧道确认状态与本地故障矩阵（WIP 云验证）
- 归属：owner 指定 Android #1673 试验端整改；遵守 docs/SHIP_PLAN.md §1「Android 不进这一发」，不改变 G1–G4 客户发布证据或门。
- 来源：基线 f769fc43b；feat/android-singbox-horizon / [#1673](https://github.com/raydocs/tono/pull/1673)；本批先提交/推送 wip/android-state-authority 供 Devin Cloud 验证；未合 main，未更新 PR 分支。
- 缺陷修复：尝试身份与 applied 状态分离；未知 VPN 不能确认连接；失联/旧代际事件不宣告当前线路；暂停前旧回调以 callback epoch 隔离；目录 IO 结果回到引擎串行提交，目录变更先清确认再重载。实现待完整 Android 验证，不宣称历史否决已消除。
- 新增/优化：故障矩阵及共享确认投影、单调时钟 freshness、带锁/检查 rename 的状态文件；暂停视觉打磨。
- 工程与测试：设备夹具补确认字段和单调时钟，新增不自动下载的纯 JUnit 子集入口；无 CI 修改。
- 验证：主线程本机实际运行 46 个真实 JUnit 测试通过；未知 VPN 回归在旧源码编译成功后断言失败。证据 docs/agent-reports/2026-10-19-android-state-jvm/README.md。git diff --check 通过。
- 未运行：正式 Gradle/Android/Robolectric/AndroidTest 编译与设备测试、真机/真实服务；历史 CI 仅覆盖原基线，没有本批冻结评分。
- 候选/发布：WIP 源码验证，无客户候选或 release；云验证未通过前不更新 PR 分支。
- 剩余限制：owner 已取消本机组件安装要求；正式编译/测试改到已准备的 Devin Linux KVM 快照，按精确 SHA 留证。通知/widget 调度时延、重载 openTun、API29/OEM owner UID、通知替换竞争仍待验证。
- 2026-10-19 Devin 首轮续记：WIP 629849a1c 编译/lint 成功、routing 16/16、矩阵类 75/75；全 mobile 103 项中 1 失败、17 opt-in skip。保留失败；修正序列化 fixture 的确认字段，不减测试/不改产品规则。云会话及原件摘要见 docs/agent-reports/2026-10-19-android-devin-state-r1.md。

- 第 1 轮冻结 a140bac84 的 GPT 独立盲评 78/100、有否决；Opus 因图像策略未评分，owner 作废，改由 Fable 原生子代理独立评审。不修改评分表。
- 续修 WIP：持久通知取消当前保护断言；系统设置取消缓存保护保证；账号 IO 返回结果后按账号 epoch 串行提交；登录请求及同 attempt 探测各自 fenced；首页用 applied 线路，选择与清确认原子提交；关键文字/按钮底色即时切换，断开即夜景。
- 新增 15 项 JVM/Robolectric 回归；t5/t6 公开通知无 VPN 断言去掉 grace/重启例外，原内部 metadata 收敛断言保留。实现待 Devin 验证，暂不更新 PR 分支；真机/真实服务/签名包仍未验证。
- Fable 第 1 轮独立评分 82/100、无否决但未过总分门槛；未查看 MP4 的限制原样保留。合并减弱动态/文字过渡、200% 双行吞吐量与箭头首行对齐、登录错误就近显示、通知 Cancel 一致性；不重做材质/评分标准。
- 续修云首轮 1a5bb985e 保留失败：118 mobile 中1条手动时钟回归失败，17 opt-in 另跑全绿；lint/APKs 成功，15+1设备方法通过；通知基线红测实际断言失败。隧道6方法因临时夹具凭证规则未执行；原9方法简报纠正为6 tunnel +3 DeviceEvidence。下一提交补重组同步、保留新旧标签断言、u8 normal/reduced 原尺寸帧，不宣称已验证。详见 2026-10-19-android-state-truth-devin-r1.md。
- 证据补全：系统通知设备夹具此前重建 EngineSnapshot 丢掉 attempt/applied，导致 connected 文件实为 Connecting；改为保留既有确认字段并断言 PHASE，另采真正 Connecting。加设备 desired≠applied 线路断言/原图与系统提示独立可见截图，避免以文件名或遮挡区冒充证明。待云执行。
