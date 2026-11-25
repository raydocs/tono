# 0.0.85 · Build 86
> Apple Silicon、macOS 26.3+。本版扩展国内直连与局域网访问、平滑轮换策略签名密钥，并新增站点流量与卡顿诊断回传。

- 扩展国内直连与局域网访问（#1850）：新增 `.cn` 域名及 ToDesk、政采云（`assetcloud.zj.gov.cn`）、Gitee、即梦（`jimeng.jianying.com`）、万网（`wanwang.aliyun.com`）直连分流，将国内阿里云百炼（`dashscope.aliyuncs.com`）切回直连，并在 macOS 默认开启本地局域网设备访问
- 策略签名密钥平滑轮换（#1851）：升级策略签名主公钥并保留旧密钥只读回退，确保老策略与平滑热更新不断流
- 网站流量与卡顿诊断回传（#1851）：在连接关闭与断开时统计每个站点的真实上下行字节、耗时与零下行卡顿率，用于后台全局站点监控与分流优化
- 携带中继入口 `static.bicon.dev` 与原生 v1 安全更新能力（`releaseSequence` 8501）

## 时间线
扩展国内直连与局域网访问（含 `.cn`、ToDesk、政采云、Gitee、即梦、万网与阿里云百炼），完成 `traffic-policy` 签名密钥平滑轮换兼容，并在连接关闭与断开时采集各站点真实流量与零下行卡顿率用于运维后台优化。

## 限制
- 仅 Apple Silicon，需 macOS 26.3 或更高
- IPv6 全程关闭：TUN 与 fake-ip 只走 IPv4，AAAA 拨号由 Kill Switch 丢弃后客户端改试 IPv4
