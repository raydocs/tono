## 2026-11-17 · API 中继改为两台：Westwood 换新 IP，去掉 Arosscloud

- 缺陷修复：Westwood 中继 179.253.233.220 被封后，没有隧道时（首次登录、重新登录、令牌刷新）客户端只走中继（决定 091），三台中继都连不上就无法登录，报「Tono 连不上任何一台中继」。现在编译进客户端的中继是 Westwood 179.253.244.3:2053 与 Mesa 179.255.154.17:2053，去掉 Arosscloud 154.84.56.196。
- 范围：macOS（`ControlPlaneRelays`，helper 4.52.70 → 4.52.71，`CONTRACT.sha256` 同步，装机的 helper 会弹一次管理员授权）、iOS、Android、Windows（`API_RELAYS`，WFP 规则命名空间 `…9e10…` → `…9e11…`）、控制面探测列表 `api-relays.ts`、`cn_acceptance.py`、运维手册。
- 注意：地址编译在客户端里，已安装旧版的用户在更新前仍用旧 Westwood 地址；连不上中继的人要换网络（手机热点）登录或手动安装新版。Westwood 作为出口节点的地址（目录里的 Reality 443）是另一条记录，这次没有改。
- 验证：新地址 TLS + `GET /api/v1/auth/methods` 返回 200（2053 端口，真实主机名 SNI）。
