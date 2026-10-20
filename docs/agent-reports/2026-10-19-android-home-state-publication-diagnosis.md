# 手动时钟回归诊断（不是评分或验收通过）

## 被定位的问题
`HomeInteractionTest.stateAndPrimaryLabelsReplaceImmediatelyWithoutFadingCopies` 在 ef6f3ab9e 的第287行缺 StateDescription=Connected；没有语义树，不能凭断言失败认定产品根因。
两帧试探没有解决，停止增加 tick。独立只读 GPT xhigh 指出须先证明新状态已组成，再判断文字过渡；CLI 诊断401未执行，改用 T3 同模型/effort。

## 实际云端四格对照
原会话：https://app.devin.ai/sessions/517a6d6189b04ef19980c212ecff96cd
精确源：`83fec0868f3ef9c2b9090dbb519338ee4ef4e731`。
原件：`~/.local/state/devin-cloud/runs/20261019-225853-wait-517a6d618/attachments/83fec0868-diagnostic-evidence.zip`。
主线程读取原始 JUnit XML 的 system-out，不仅依据云摘要：

| 入口 | 写入后显式 sendApplyNotifications | 结果 | 原始顺序要点 |
|---|---|---|---|
| HomeScreen | 无 | 失败 | input CONNECTED → apply notification → 两 tick 后仍 Not connected；没有 entry-composed CONNECTED |
| TonoRoot | 无 | 失败 | 同上，不是 wrapper 独有 |
| HomeScreen | 有 | 通过 | input → apply notification → entry-composed CONNECTED → 两 tick 后 Connected；回 IDLE 亦符合 |
| TonoRoot | 有 | 通过 | 同上，新旧标签及主操作状态断言都执行通过 |

四格同一两帧预算、相同安全断言：4执行、2通过、2失败、0skip/error。失败保留，没有重跑刷绿。普通118项验收本次未运行。
这支持**测试的发布/时钟同步边界**是该失败来源；没有 wrapper-only 证据，不修改产品导航或隧道确认规则。
不能由此证明真实手机无绘字问题、像素完全可读或系统帧率达标。

## 最小纠正与后续证明
仅在原测试两处 runOnIdle 状态写入后调用 `Snapshot.sendApplyNotifications()`；全部断言、TonoRoot 入口、reduceMotion=false 与两 tick 不变，不加 sleep 或等待动画。
纠正后须在原 VM 跑真实回归、全118测试/17 opt-ins/相关设备方法，并在旧交叉淡化行为上编译成功后跑出**文字断言**红测；尚未执行，不先写通过。
首个88dc诊断因源目录注册错误未发现任何测试，属于工程失败，不算红/行为证据；83fec使用 AGP9 的 test.kotlin 根后才真正执行四格。
LocalTunnel/HOST route 由 owner 明确本轮不需要；不生成凭证，不记为通过，后续精确 PR SHA 的 CI tunnel 仍须核对。

原件 SHA256：`06ccf883f7b12ac2958616f932997c389a81ebb66618dd483d52a0387b9d4ebf`。
