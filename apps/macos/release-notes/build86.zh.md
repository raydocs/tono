# Tono 0.0.85（build 86）

支持 Apple Silicon 与 macOS 26.3+。

## 相比 build 85 的更新

- **扩展国内直连与局域网访问**（#1850）：新增 `.cn` 域名及 ToDesk、政采云（`assetcloud.zj.gov.cn`）、Gitee、即梦（`jimeng.jianying.com`）、万网（`wanwang.aliyun.com`）直连分流，将国内阿里云百炼（`dashscope.aliyuncs.com`）切回直连，并在 macOS 默认开启本地局域网设备访问。
- **策略签名密钥平滑轮换**（#1851）：升级策略签名主公钥并保留旧密钥只读回退，确保老策略与平滑热更新不断流。
- **网站流量与卡顿诊断回传**（#1851）：在连接关闭与断开时统计每个站点的真实上下行字节、耗时与零下行卡顿率，用于后台全局站点监控与分流优化。
