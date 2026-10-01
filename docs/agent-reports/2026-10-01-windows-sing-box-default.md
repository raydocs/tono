# 2026-10-01 · Windows 默认核改为 sing-box

用户 2026-10-01 批准。macOS 已经用 sing-box（钉在 v1.15.0-alpha.9）。Windows 连接在 WFP 武装前选择内核：默认 sing-box，mihomo 仍打包，只作显式回退，或在二进制缺失 / 未认证且尚未武装时自动回退。不关闭 [#203](https://github.com/raydocs/tono/pull/203)。

归属 SHIP_PLAN G1。不是客户发布。needs-hardware。

## 对齐

| 项 | mihomo（显式或武装前回退） | Windows sing-box（默认） |
| --- | --- | --- |
| 默认 | 不再是默认 | 缺记录、损坏、别人的记录都是 sing-box |
| 显式开关 | schema 2 `core: mihomo`，或 schema 1 `sing_box_core: false`，且 device_id 等于本机 | 同一份记录不写 mihomo 就是 sing-box |
| 武装前自动回退 | 镜像缺失，或 pin 缺失 / 对不上 | 不在武装之后换核 |
| 服务太旧 | 协议 &lt; 18 不能跑 sing-box | 拒绝，不偷偷改跑 mihomo |
| 武装后失败 | 既有放行普通网络、AI 仍拦（决策 031） | 同样，不改去启动 mihomo |
| AI 拦截 | 进程与域名规则，严格模式才全拦 | 编译器同一套 home / 模型域名规则 |
| 已审应用 DIRECT | 进程路径，连接成功后热更新 | 首连仍是全隧道。`PUT /configs` 在 alpha.9 是空操作，所以成功后的 DIRECT 先跳过，避免重载括号失败把流量留在 Blocked |
| DNS | 回环 :53，保护 DNS 由 Service 指到隧道 | 模板 inbound `127.0.0.1:53`，同样由 Service 保护 |
| fake-ip | `198.18.0.1/16` | `198.18.16.0/20`，在 Windows 探测前缀内、在 TUN /30 外 |
| HY2 | DER `fingerprint` | 有 SPKI 才发出 `certificate_public_key_sha256`。不从 DER 推导。选中却没有 SPKI 则编译失败；没选中的记为不可用 |
| 协议 | VLESS Reality、HY2 | 相同。目录不收 Trojan / VMess / SS |
| 连通判定 | 数据面证明之后才 Connected | 同一条 `verify_post_lock` |
| 延迟探测 | 数据面证明后等 1.5 s（与 #1122 同一常量） | 同一条成功路径，不挡住 Connected |
| 控制器回读 | `/rules` 用 mihomo 字符串 | 本批还没有 sing-box 的 String() 对照 |
| TUN | gVisor 窗口是 #1119，与 sing-box 无关 | 不写 `stack`，也不写 `tcp_fast_open`。发送 2 MiB、接收 4 MiB 是 alpha.9 sing-tun 的二进制上限，不是 JSON 字段。与 macOS 同一条 |
| DoH | #1121 把 mihomo 改成懒查询 | 模板已是：先 evaluate 主用，只有 NOERROR 才 respond，然后才 evaluate 备用。无 `race`，ALPN `h2`，detour `Tono-Exit`，无明文 DNS |
| 两个二进制 | `tono-core.exe` 仍在 | `sing-box.exe` 应放在同目录。安装事务仍是三个文件；缺镜像时武装前回退 mihomo |
| 协议版本 | 17 及更早仍可释放 WFP | 18 才会按 sing-box 启动 |

## 还没做

- 把 `sing-box.exe` 和 `sing-box-sha256.txt` 放进安装与升级的替换事务。pin 未设置或文件不在时，连接前回到 mihomo，这是批准过的回退，不是把默认改回去。
- sing-box 的 DIRECT：在 WFP 仍武装时换进程，再用 alpha.9 的 `/rules` 字符串核对。现在跳过，全隧道保持可用。
- 真实 Windows 上的吞吐、首包和 DoH。需要备用机。

## 备用机清单

先备份这台备用机，不要用日常主力机。

1. 记下当前网络能打开普通网页，并确认 AI 站点被拦（如果这台机本来就开着保护）。
2. 安装同时带 `tono-core.exe` 与已核对摘要的 `sing-box.exe` 的构建。摘要文件是旁边的 `sing-box-sha256.txt`，或编译进 `TONO_SING_BOX_SHA256`。
3. 不写 `sing-box-core.json` 就连接。进程应是 `sing-box.exe`，参数含 `run -c` 和 `config.json`，没有 `stack`。
4. 打开一个普通网页，再看延迟数字是在连上大约 1.5 秒之后才出现。
5. 断开主用 DoH 时，解析仍能回来，并且没有并行打两家。
6. 把 sing-box.exe 挪走再连接（此时未武装）：应改跑 mihomo，普通网络仍在。
7. 连上之后再让 sing-box 退出：应放行普通网络并继续拦 AI，不应改去启动 mihomo。
8. 写上本机的 `{"schema":2,"device_id":"<installation_id>","core":"mihomo"}` 再连接：应是 mihomo。
