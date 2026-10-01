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
| 已审应用 DIRECT | 进程路径，连接成功后热更新 | 首连仍是全隧道。协议 19 在连上之后换进程，不走 mihomo 重载括号，也不调用会进 Blocked 的 begin。`/rules` 必须先证明 AI 后缀不走物理网卡，并且含 `process_path_regex`。对不上、许可装不上或装上后状态对不上，就换回全隧道文档。这次回滚失败不会把 DIRECT 规则写回去；隧道仍证明不了，才放行普通网络，AI 仍拦。协议 18 没有这条路由，保持全隧道 |
| DNS | 回环 :53，保护 DNS 由 Service 指到隧道 | 模板 inbound `127.0.0.1:53`，同样由 Service 保护 |
| fake-ip | `198.18.0.1/16` | `198.18.16.0/20`，在 Windows 探测前缀内、在 TUN /30 外 |
| HY2 | DER `fingerprint` | 有 SPKI 才发出 `certificate_public_key_sha256`。不从 DER 推导。选中却没有 SPKI 则编译失败；没选中的记为不可用 |
| 协议 | VLESS Reality、HY2 | 相同。目录不收 Trojan / VMess / SS |
| 连通判定 | 数据面证明之后才 Connected | 同一条 `verify_post_lock` |
| 延迟探测 | 数据面证明后等 1.5 s（与 #1122 同一常量） | 同一条成功路径，不挡住 Connected |
| 控制器回读 | `/rules` 用 mihomo 字符串 | alpha.9 的 `Type()` / `String()` / `Action().String()`。只含 route 规则，不含 DNS。许可用服务返回的端点摘要核对，不用本机另算的一份 |
| TUN | gVisor 窗口是 #1119，与 sing-box 无关 | 不写 `stack`，也不写 `tcp_fast_open`。发送 2 MiB、接收 4 MiB 是 alpha.9 sing-tun 的二进制上限，不是 JSON 字段。与 macOS 同一条 |
| DoH | #1121 把 mihomo 改成懒查询 | 模板已是：先 evaluate 主用，只有 NOERROR 才 respond，然后才 evaluate 备用。无 `race`，ALPN `h2`，detour `Tono-Exit`，无明文 DNS |
| 两个二进制 | `tono-core.exe` 仍在 | `sing-box.exe` 是安装事务的第四个成员，摘要钉死 alpha.9。pin 未设置且没有 staged 文件时（开发构建）仍跳过，连接前回到 mihomo |
| 协议版本 | 17 及更早仍可释放 WFP | 18 才会按 sing-box 启动。19 才会为 DIRECT 换进程。第四个二进制不另加 IPC。`MIN_REQUIRED` 仍是 14 |

## 还没做

- 真实 Windows 上的吞吐、首包、DoH，以及审阅应用走 DIRECT 时 AI 仍被拦。需要备用机。`sing-box.exe` 不在 git 里。

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
9. 用默认 sing-box 连上之后，审阅应用应能走 DIRECT，AI 站点仍被拦。若 `/rules` 对不上，普通流量应留在全隧道，机器不应停在断网。
