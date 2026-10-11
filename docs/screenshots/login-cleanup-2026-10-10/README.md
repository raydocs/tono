# 登录精简与一次有限走查

归属 SHIP_PLAN G2，[#1566](https://github.com/raydocs/tono/pull/1566)，merge after 默认中文 [#1561](https://github.com/raydocs/tono/pull/1561)。恢复信号来自已合 main 的 [#1564](https://github.com/raydocs/tono/pull/1564) / decision 093，不由 UI 计时或保护状态推导。

## 原图来源，不是设备验收

全部 Windows 图片为 Linux Chromium / DPR 2、真实生产组件与 en/zh 资源、明确合成 native IO。没有实际账号、邮件、网络请求、节点凭据或 OS 权限操作。PNG 原样复制归档，未拼图、缩放或修改像素。目录沿用本轮日期，实际捕获 2026-10-11 UTC。

- Before：[bde3cda74](https://github.com/raydocs/tono/commit/bde3cda7442a351c3c7847cd56184fc5e11b2c5d) language 分支的未改登录 UI。不是把默认 English 的 fixture 当新装 bug。
- After 正常/隐私/进行中：[3ec80a202](https://github.com/raydocs/tono/commit/3ec80a202dda523909c996887d2722d2550560e8)。布局修正前的中间图片已替换，不归档。
- After 最终失败/复制成功失败：[d5775e9bc](https://github.com/raydocs/tono/commit/d5775e9bcbf860e1f15f6c74c446838972768de3)。支持入口实际 CSS 为 secondary 72% 白、12 px、weight 400、透明 surface/border，保留焦点 outline；中间高强调图已替换。
- Protected/走查：[11b6bbfff](https://github.com/raydocs/tono/commit/11b6bbfff610940b6c94efe3817833519e35b0b5)。剩余提交仅修 native test evidence / 归档 / 同步 main；这些特定状态的生产 UI 行为没有重做。

| 实际状态 | 图片与尺寸（CSS px） |
|---|---|
| 中文正常，主动作与邮箱同一行 | [before](windows-before-normal-zh.png) → [after](windows-normal-zh.png)，920×760 |
| 保存 English，正常 | [after](windows-normal-en.png)，920×760 |
| 用户键盘打开完整隐私说明 | [展开](windows-privacy-zh.png)，920×760 |
| native automatic 契约的合成进行中 | [中文窄窗](windows-progress-zh-narrow.png)，640×760 |
| request ended / userAction | [before](windows-before-final-zh-narrow.png) → [after 中文](windows-final-zh-narrow.png)，640×760；[English](windows-final-en.png)，920×760 |
| 用户点击后 browser clipboard Promise 成功 | [短确认](windows-copy-success-zh.png)，640×760 |
| 注入 clipboard 拒绝，不是假成功 | [失败/折叠手动复制](windows-copy-failed-zh.png)，640×760 |
| 受保护，仍允许登录 | [风险说明及显式恢复网络](windows-protected-zh.png)，640×760 |

已逐张查看所有原图。正常态无支持/diagnostic payload，进度态无错误或客服。技术细节默认折叠；userAction 才出现最终支持，absent/automatic 不出现。实际 DOM：进行中 form aria-busy=true、email disabled=true、support=false；完成后 busy=false。邮箱 → Tab 发送 → Tab 隐私详情 → Enter 展开/关闭；640/920 无横向溢出。Protected 的邮箱 enabled、普通流量仍拦截说明及“恢复网络”的直连风险可见，未静默释放。

复制只在点击后收集：版本、allowlisted UI 状态/错误码/阶段/relay 分类/恢复 cause。对实际 writeText 的出站参数观察不含 email/IP/token/验证码/operation；没有读取用户已有 clipboard。真实 Chromium 写入成功才显示“已复制”；合成拒绝后无 Copied、manual details 仍折叠。实际 Windows WebView2/OS 剪贴板与 Mac NSPasteboard 设备行为另验。

## 第 3 项：一次走查，止于可复现缺陷

| 范围 | 执行与证据 | 未被证明的部分 |
|---|---|---|
| 首次启动 | [中文 intro](windows-first-launch-zh.png)，640×760；Escape 到真实 LoginPage | lang=zh 模拟保存值；真正无偏好首帧由 #1561 回归，安装设备另验 |
| 登录 | 上述正常/进行中/最终失败/隐私/复制/键盘与窄窗操作 | 合成 IO 不证明真实网络恢复或邮件送达；不宣称 99% 成功 |
| 设置 | [已确认保存](windows-settings-saved-zh.png)，920×920；实际控件触发并等待合成 patch 回复 | 图片只覆盖通用/外观/隐私；不能证明 OS 自启动注册 |
| 托盘 | [connected + live 状态](windows-tray-connected-zh.png)，640×760；既有生产 compact panel | 不是原生 tray 宿主、窗口关闭行为或实际连接 |
| 更新 | 点击生产“检查更新”得到“测试版需手动安装，应用内更新尚未开放。”，不是“最新版”假成功 | 当前预览 updates 未配置、update hook 为 no-update adapter；未执行下载/拒签/安装失败/回滚 |
| 权限 | Protected 登录风险文字可见；Mac 既有 hosted settings approval/error/saved/unavailable 原图与 receipt 可复用 CI 38108105926 | Linux 无 UAC、SMAppService 批准、helper 提权或真实取消；健康 service adapter 不能验权限修复 |

本次只复现新 privacy disclosure 抢邮箱右侧网格槽位，已在同 PR 修复并重捕。其他未复现的美化不追加；总计语言/登录两个 PR，不开新机器、不再整体改主页。

Mac cleanup 原生截图必须来自新准确 head 的 hosted CI（当前待验），不可用旧 language/settings 图冒充 after。新中文 narrow 的 Vision 只见证精确标题；小 CJK 控件不声称 OCR 通过，生产发送 title 的确定性断言由 #1561 覆盖，原始图片待协调者视觉核实。原窗口/PID/尺寸/对比度/完整性断言不变。

## 最终设备清单

1. 英文 OS 新装 zh 首帧、保存 English 升级、Mac Apply/Cancel/quit/reopen 与原生弹窗语言。
2. 真实发送/验证/自动尝试结束、换邮箱清理、旧请求迟到、错码/限流/Keychain 不提前推支持；真实邮件送达另测。
3. Windows WebView2 与 Mac 实际 clipboard 权限/拒绝/成功/手动复制；VoiceOver/屏幕阅读器、原生键盘与高缩放。
4. UAC/helper/Login Items 批准/拒绝/取消、保护显式恢复和故障恢复；不以 fixture 证明 PF/WFP。
5. 实际 tray 宿主的打开/关闭/退出和窄窗；签名更新 check/download/拒签/安装失败/重开与回滚。

这些是具体设备验证缺口，已交主线程带入同一两端候选；没有自行顺延构建、发布或自签评分。
