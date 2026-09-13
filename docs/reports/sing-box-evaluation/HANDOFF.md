# 交给本地 Mac/Windows 主线程

**阶段A完成；产品代码未修改，两个源码确认问题交由主线程处理。阶段B未获准、未开始。**
仓库`raydocs/tono`；固定基线`1d00b581dffdd98e84821c8789eb0c46b7a21bed`；本地实验分支`experiment/sing-box-stage-a-20260913`。
本次禁止push/PR/issues/tag/release，因此交付是本地commit与可应用patch，不是已发布的GitHub PR。

## 主线程最小处理顺序

### 1. G1：最终端点收紧失败必须撤销“已完成”状态

读 [AUDIT.md A2-01](AUDIT.md#a2-01--hot-switch-endpoint-convergence-failure-can-retain-old--new-permits-while-connected)。
Windows `connection/switch.rs:250-261`明确记录保留union后仍Connected；macOS `AppState+Proxy.swift:160-218`同样没有为最终arm失败进入保护恢复。

最小patch提案（**未应用，不是可直接上线的修复**）：

- Windows：最终new-only replace失败调用现有串行cold/protected-switch owner并return，不继续发Connected；保留用户新选择，旧owner必须先排空，避免旧清理覆盖新generation。
- macOS：最终new-only `armSwitchKillSwitch`的独立catch将本次标为protected recovery，保留新选择意图，再复用现有`disconnect(releaseKillSwitch:false)`/受保护重连路径；不要把所有普通selector错误都升级成自动重连。
- 各端只补一条窄回归：第一次union arm成功、selector和真实探针成功、**只让第二次arm失败**。断言不能Connected+union；恢复后旧端点不存在。Mac需区分child-anchor load前后失败，不能沿用Rust helper的回滚假设。
- 真机抓规则/合成流量：旧TCP/UDP端点是否撤回，新端点是否严格IP+port+protocol；DNS、保护连续性与UI节点一致。

### 2. G1：缩短 Windows pin 刷新的状态锁占用

读 [AUDIT.md A2-02](AUDIT.md#a2-02--windows-pin-refresh-holds-product-state-across-a-transport-write-lock-await)。
`TonoTransport::send`的read guard覆盖HTTP await；pin刷新持`TonoState`等write guard，阻塞disconnect推进generation。

局部patch提案：在`refresh_control_plane_pins_once`与同类启动/hydration调用中，state锁内clone client，释放state锁再await刷新；需要发布状态时重新核对generation。
另一个更靠近根因、可由主线程评估的最小改法是clone reqwest client后释放read guard：

```diff
 let pinned = {
-    let client = self.client.read().await;
+    let client = self.client.read().await.clone();
     self.attempt(&client, &request).await
 };
```

这个文本改法尚未编译/验证；应明确旧在途请求继续用旧pin快照、新请求用新client的合同，不替代generation/所有权检查。
只补一条真实异步回归：挂起transport read/请求，让refresh开始，再证明disconnect能先取得state并推进generation；最后释放旧请求，不能发布旧owner结果。不要复制重写整个状态机当产品回归。

### 3. 保留既有发布门

- G1：Mac/Windows真实connect/cancel/retry/switch/crash/disconnect与DNS恢复、仪表盘/Activity/托盘。
- G2：真实授权采集→存储→ops读取；运营商Reality/Hy2证据；本版手动备用合同不变。
- G3：#26安装器身份绑定、特权保护交接、两端受保护成功/失败更新；保留失败journal。
- 已修项不重复开Bug：日志账户/授权cursor边界、Windows切换“requested”文案、损坏更新证据提示、macOS DIRECT收紧失败保护恢复。

## 如何转移实验成果

当前Orb里的两个worktree共享Git对象；本地Mac不是这个Orb，单发commit SHA不会自动传文件。
Owning thread在仓库外生成`tono-stage-a.patch`供下载，只含报告/工具/小型合成数据，不含产品变更。
主线程可先审查，再在自己的独立分支/实验worktree应用；不要覆盖进行中的产品改动：

```sh
git apply --stat /path/to/tono-stage-a.patch
git apply --check /path/to/tono-stage-a.patch
# 如需保留交付commit元数据，在独立分支使用：
git am /path/to/tono-stage-a.patch
```

没有自动同步，也没有将Orb实验二进制放入Resources/sidecar。构建和profile较大产物留在`/tmp/tono-stage-a-20260913`，可按BASELINE复建；小型原始JSON/CSV随patch转移。

## 阶段 B 就绪程度

已具备：固定patched Mihomo、工具身份校验、namespace安全边界、真TUN能力证据、合成TCP/UDP、抓包、失败/超时控制、有限profile通路。
尚未具备：同commit的sing-box B/C固定构建、真实栈选项核实、合成Reality/Hy2服务与配置adapter、真实TUN数据面比较、netem、平台安全语义等价。
`PARITY.md`已确认Clash API的reload不能照搬。**先解决合同再比性能**；没有根据这次SOCKS时间推荐迁移。
收到明确“允许开始阶段 B”以前保持暂停，不创建监控或自动运行。
