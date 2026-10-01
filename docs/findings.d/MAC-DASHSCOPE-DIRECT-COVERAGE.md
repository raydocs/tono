| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-DASHSCOPE-DIRECT-COVERAGE | macOS 专属模型 API 域名缺少助手路由与 DIRECT 排除，携带主机名的普通代理请求会被 Alibaba 网页后缀送到物理网卡 | open | 待开记录 PR | 高·推导 | P1；只确认携带域名的 mixed/代理请求，不声称当前默认 TUN 的每个 Python 请求都直连。专属 API 域名需与签名后缀策略迁移及选择性失败恢复名单协调；本槽禁止编辑 helper，不削弱原受保护后缀重叠拒绝。未编译或实机验证。 |

基线 `1fb29265`：`ConfigPipeline.swift:114` 的产品网页直连包含 Alibaba 服务树，而 `:309–403` 的助手服务列表没有其专属模型 API；`ConfigPipeline+Direct.swift:32–41` 的排除列表随之遗漏。`ConfigPipeline+SingBoxProduct.swift:205–208` 在普通助手客户端的保护规则未命中后选择物理接口绑定的网页 DIRECT。此路径在住宅跳存在时也成立，故不是 #867 的「没有住宅跳就不发助手域名规则」缺口。#958 改变默认 TUN 的域名保留，不会补齐服务分类。

[Alibaba 官方模型 API 端点文档](https://www.alibabacloud.com/help/en/model-studio/base-url)（2026-09-28）确认专属 DashScope / Model Studio API 系列和区域、workspace/trial 端点；[官方 Python SDK](https://github.com/dashscope/dashscope-sdk-python) 确认默认 Qwen 模型调用。这里只记录缺失的专属服务分类，不建议阻断 Alibaba 的共享服务树或其 IP。

不修的依据：单独扩展助手域名列表会同时让 `directSuffixOverlapsProtected` 拒绝原本有效的较宽签名 DIRECT 后缀；不得为迁就现有策略放松这个有意的保护门。非严格退出的选择性恢复名单（macOS helper 与 Windows service）也缺少这些模型 API，配置列表的局部补丁无法完成统一保护。本槽禁止 helper 编辑；需要协调专属模型 API 分类、签名策略迁移及恢复名单，一并保持普通网络可用。未发现明确的中国 AI 服务豁免决定，本项按用户要求的 AI 服务保护不变量记录。
