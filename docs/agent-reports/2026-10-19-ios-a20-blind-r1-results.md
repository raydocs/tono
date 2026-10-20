# iOS a20 第1轮双盲评：未达标

## 同一冻结对象

- SHA `a20b3c1074434a938d6c04da5b43b1f4c5ff3ad7`；[iOS CI](https://github.com/raydocs/tono/actions/runs/39347647852) 与 [ci-gate](https://github.com/raydocs/tono/actions/runs/39347654152) 均 exact-head success。
- 采集会话 3c14bd1f，原始结果 blocked，115 附件、57 已采集+15 跳过矩阵、35 UI 测试 passed/0failed/0skipped；不是产品全通过。
- 所有者授权缺口不补采：两份报告第5节列未覆盖场景，不因此扣分/猜测给分。没有改评分表，无自评分。
- 原始报告：[GPT](2026-10-19-ios-a20-blind-r1-gpt.md)、[Fable](2026-10-19-ios-a20-blind-r1-fable.md)，按文件字节与外部 REVIEW.md 核对一致。

## 独立结果（不取平均）

| 项目 | GPT-6.1 Sol xhigh | director-fable |
|---|---:|---:|
| D1 /20 | 17 | 18 |
| D2 /20 | 16 | 17 |
| D3 /15 | 13 | 12 |
| D4 /15 | 12 | 12 |
| D5 /15 | 13 | 12 |
| D6 /10 | 9 | 8 |
| D7 /5 | 2.5（低于3.5门槛） | 4 |
| 总分 | **82.5，FAIL** | **83，FAIL** |
| 否决 | **有：F2 catalog身份导致当前路由误导，源码推断，未动态复现** | 无 |

GPT 的 F1/F2/F3 均为 major 源码推断，不冒充真实账号/NE 复现。Fable 通过 Agent director-fable（harness 标为 Fable5.1；调用结果无独立 model ID）完成；Claude桥接仅保存文本并移除 harness 两空格缩进，没有自行评分。

## 合并修复批次（仅 WIP，尚未验证）

1. **账户边界（GPT F1）**：AccountSession 的 actor 重入可让登出前 refresh/catalog 回应写回 token/cache；AppModel 亦需独立 UI account epoch 门禁。持久缓存按账户/登录会话绑定，legacy/unbound 不猜归属。受控延迟响应回归验证，不能只取消任务。
2. **运行图输入身份（GPT F2/V1）**：mode/node/session/generation 不足以识别 catalog；同 mode/node 但 Home分配改变可错说真实路径。隧道确认 exact-input/catalog digest，admitted/running 分开；所有路径解释/health/line 使用身份一致的运行快照，未知则保守。
3. **Cancel 意图（GPT F3）**：VPN 配置 save/load 后不得迟到 start，首次 manager 尚未赋值也须 disarm On Demand；单调意图令牌及串行 coordinator，注入挂起 prepare 的单测覆盖。
4. **文案/任务效率（两份共同）**：缩短 Settings重复教学而不隐藏安全边界；明确 Home家宽是 AI 跳，Dropped 的 Retry行动清楚；未知core版本不显示破折号插值。
5. **动效/适配（评审细节）**：Reduce Motion 无延迟暗字，arrival fill handover不误导动作层级；小屏/AX5完整主操作及导航可达。Fable的直接 bottom-scroll建议需结合iOS16最低目标和首屏状态可见性核对，不能照搬。
6. **locale/附属标记（owner+Fable D3）**：compact日轮标记与品牌一致；owner要求修 zh Live Activity混语。两评审认为混语可能是独立extension语言/fixture捕获造成，均未真机验证；保持owner问题open，拟显式传递Activity显示语言，不能把源码推测当已排除问题。

先解决1–3再推进4–6，不改变玻璃/对比度算法或门槛来迎合分数。还有且仅有第2轮评分机会；若未通过，报告真实阻碍，不继续刷轮。

## 当前编排

三个 Opus5.5/high、implementation/async/shared 子任务，修改范围互斥：Account+Storage+账户回归；catalog协议+AppModel+provider+相关回归；TunnelController+启动协调器+回归。子任务不提交、不推送、不本机构建测试。根线程负责接线与UI收敛及最终校验；所有执行走Devin，先WIP推送，不提前更新PR。

无新源码测试通过结论。真机六项清单仍未执行；不发release、不改main、不上传TestFlight。
