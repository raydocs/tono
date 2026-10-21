# Android 状态矩阵：主线程本地 JUnit 证据

基线 HEAD/origin `f769fc43b0d9c73062f126e8edfb734467aa1f9e`，未提交工作区；不是冻结 commit，不是 CI 或盲评。
本批改动仍不能推送：完整 Gradle/Android/Robolectric/设备验证未运行。

## 实际运行（主线程复核，不采用子任务成功声明）

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME="$HOME/Library/Android/sdk" \
python3 apps/android/scripts/run-state-jvm-tests.py \
  --junit-dir /tmp/tono-state-junit.sCxBUd \
  --output /tmp/tono-state-verified-20261019-01
```

原始输出见 `junit-green.txt`：`JUnit version 4.13.2`、`Time: 0.123`、`OK (46 tests)`，编译和 JUnit 进程均 exit 0。
14 TunnelAuthority + 16 SurfaceRules + 7 StatusFile + 9 ClaimRules = 46，全部实际执行，无 skip。

- 使用已有 Homebrew JDK17、SDK36 的 android.jar（只提供编译类型；不调用 Android stub 方法）。
- 用缓存中的 Kotlin compiler 2.3.20 编译实际 routing 源码与 EngineSnapshot、TunnelAuthority、PublicStatus、ClaimRules，加实际四个测试类。
- **没有替身 JUnit、没有产品源码 stub、没有手写测试 runner**；真正的 JUnitCore 会执行断言、@Rule TemporaryFolder 及测试生命周期。
- 只下载 Maven Central 的 junit:4.13.2（384581 bytes）、hamcrest-core:1.3（45024 bytes）到临时目录，核对 Maven SHA-1 元数据；未安装 SDK/JDK/AVD/Gradle/Go/NDK。
- 编译器启动第一次因未加缓存的 kotlin-reflect 出现 NoClassDefFoundError，未执行测试；补齐已有 reflect jar 后成功。它不是产品失败或 red check，不计作回归证据。
- 编译器版本不同于正式 AGP 工程路径；本结果是独立的纯逻辑 JUnit 子集，不代表 pinned Gradle 9.5.1/Android 插件构建通过。
- `inputs.sha256.json` 记录该次生产源文件、测试源文件和编译输入摘要。根目录绝对路径是本次主机证据，不是账号凭据；没有复制 jar/class 文件进仓库。
- 临时目录保留 compile/junit 命令、日志和 classes；脚本不下载输入，缺依赖会明确退出，输出目录存在会拒绝覆盖。日后重新运行应使用新的 output 路径。

## 实际 Red check

在临时目录用 `git show f769fc43b:<path>` 取出旧 EngineSnapshot/PublicStatus；不切换或改写工作区。
从当前 `SurfaceRulesTest.kt` **逐字提取** `anUnknownVpnReadingIsNotProof` 方法（不改断言和输入），放入只含该方法及原 import 的 focused JUnit 类 `UnknownVpnRegressionTest`。
该方法用 JSON 输入兼容新旧 schema，先断言已知 VPN 为 true 时确实 CONNECTED，排除空/无确认记录导致的空过；再断言未知 VPN 必须 UNKNOWN。
旧源码与该测试成功编译（exit 0），真正 JUnitCore 执行结果见 `junit-baseline-red.txt`：

```text
java.lang.AssertionError: expected:<UNKNOWN> but was:<CONNECTED>
FAILURES!!!
Tests run: 1,  Failures: 1
```

测试进程 exit 1，失败来自目标断言，不是编译错误/跳过。当前源码上同一方法随 46 个测试通过。
其他故障行为的 old-code red、Robolectric 和设备场景尚未运行，不能外推。

## 集成核对（源码，不是设备执行）

- AndroidTest 的 Connected fixture 现带 applied/attempt/session，明确保留 FIXTURE/no tunnel 标记；不将夹具确认当作真实隧道证据。
- SystemSurfacesDeviceTest 改用 elapsedRealtime 测 age，且显式断言 Connected/Degraded 的案例确为目标状态，避免所有截图都变 Unknown 仍通过。
- LocalTunnelDeviceTest 采样改为生产的 PublicStatusStore.current，消除把墙钟传给单调时钟参数造成的空过。
- 源码核对发现 loadCatalog 在 IO 线程调用 update，违背单写者约束；现返回 LoadedCatalog，交由引擎线程提交 cached 标记与目录。后台刷新按 attempt 拒绝过期结果，活动隧道换目录先清确认再重载。该 VpnService 代码尚未编译/运行，不能用文件锁的 JUnit 代替其线程集成验证。
- EngineClient 新增 callback epoch：旧 listener 跨 pause/resume/unbind 的回调即使未听到引擎死亡也不能覆盖 fresh snapshot。`aCallbackRetainedAcrossPauseCannotReplaceTheFreshResumeSnapshot` 已写，**Robolectric 未运行**。
- 对固定 sing-box commit `25b0d5ea3e466d246c708ac0f20d0448110e566c` 只读查源码：experimental/libbox/command_server.go:210 委托 daemon/started_service.go:250，后者先 Close 旧 instance，再 newInstance、Start，最后返回；daemon/instance.go:165 委托 Box.Start。这支持“reload 重新建 core”的设计，不证明 Android 实际一定重新 openTun；还要本地节点/模式切换设备测试。

## 未执行与未完成

正式 Gradle、完整 JVM/Robolectric、AIDL/Compose/VpnService/BoxPlatform 编译、AndroidTest 编译及执行、模拟器、真机、Doze 时延、实际 launcher widget、TalkBack、真实 Tono 服务、性能均未验证。
没有新 CI、没有冻结 SHA、没有新盲评分数、没有推送/发布/系统网络修改。
