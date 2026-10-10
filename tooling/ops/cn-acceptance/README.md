# Tono 中国大陆网络验收 / Mainland China network acceptance

一条命令，在中国大陆的一台电脑上（macOS、Windows 或 Linux）检查 Tono 客户端用到的每条网络路径，
生成一个 JSON 文件发回即可。不需要账号、密码或任何密钥，不安装任何东西。
详细含义见 [docs/ops/cn-acceptance.md](../../../docs/ops/cn-acceptance.md)。

One command on a computer inside mainland China (macOS, Windows or Linux) checks every network
path the Tono clients use and writes one JSON file to send back. No account, password or secret;
nothing is installed. What each result means: [docs/ops/cn-acceptance.md](../../../docs/ops/cn-acceptance.md).

## 中文

1. 需要 Python 3.8 或更新（macOS / Linux 自带 `python3`；Windows 从 python.org 安装，勾选 “Add to PATH”）。
2. 下载 `cn_acceptance.py` 一个文件即可（hy2 那一步另需 `../hy2/hy2_probe.py`，见下）。
3. **先断开 Tono 和任何 VPN / 代理**，用平时上网的网络（家宽、手机热点等），然后运行：

   ```sh
   python3 cn_acceptance.py --label "上海 移动 家宽" --carrier cmcc
   ```

   Windows：`py cn_acceptance.py --label "上海 移动 家宽" --carrier cmcc`。
   `--carrier`：`cmcc` 移动、`ct` 电信、`cu` 联通、`other` 其他。`--label` 只写城市和接入方式，不写住址、姓名或账号。
4. 大约 1–5 分钟。每一项打印一行 `PASS` / `FAIL` / `UNKNOWN` 和原因，最后打印矩阵，
   并在当前目录生成 `tono-cn-acceptance-<时间>.json`。**把这个 JSON 文件发回来**。
   文件里没有密码，公网 IP 只保留前三段（/24）。
5. macOS 上如果提示 “CA store EMPTY”：运行一次 `/Applications/Python 3.x/Install Certificates.command`，再重跑。

可选的 hy2 握手（只有老板给了测试账号时才做；仅 macOS / Linux）：

```sh
python3 cn_acceptance.py --label "上海 移动 家宽" --carrier cmcc \
  --hy2-auth-file ~/.tono-hy2-probe --hy2-cert-dir ./hy2-certs --hysteria ./hysteria
```

- `--hy2-auth-file`：只含测试账号 UUID 的文件，权限 `0600`（`chmod 600`）。本工具只把路径交给
  `hy2_probe.py`，自己不读、不打印、不写进 JSON。
- `--hy2-cert-dir`：每个节点的公开叶子证书，文件名 `<节点IP>.pem`（老板提供）；证书与仓库里的指纹不符就不握手。
- `--hysteria`：官方 hysteria v2 客户端（与节点同版 v2.12.2）。

## English

1. Python 3.8 or newer (`python3` on macOS / Linux; on Windows install from python.org with "Add to PATH").
2. Only `cn_acceptance.py` is needed (the hy2 step also needs `../hy2/hy2_probe.py`).
3. **Disconnect Tono and any VPN / proxy first**, stay on the everyday network, then run:

   ```sh
   python3 cn_acceptance.py --label "Shanghai CMCC home broadband" --carrier cmcc
   ```

   Windows: `py cn_acceptance.py ...`. `--carrier` is `cmcc`, `ct`, `cu` or `other`. `--label` is
   city and access type only; no address, name or account.
4. Takes about 1–5 minutes. One `PASS` / `FAIL` / `UNKNOWN` line with a reason per check, then a
   matrix and `tono-cn-acceptance-<time>.json` in the current directory. **Send that file back.**
   It contains no credential, and the public IP is cut to its /24 (IPv6: /48).
5. "CA store EMPTY" on macOS: run `/Applications/Python 3.x/Install Certificates.command` once and rerun.

Optional hy2 handshake (only with an owner-issued test account; macOS / Linux): pass
`--hy2-auth-file` (a `0600` file holding the test account UUID; passed to `hy2_probe.py` by path,
never read, printed or stored by this tool), `--hy2-cert-dir` (each node's public leaf certificate
as `<node-ip>.pem`; refused when it does not match the fingerprint in the repo) and `--hysteria`
(the official v2 client).

Exit code: 0 no FAIL, 2 at least one FAIL, 1 setup error. Other options: `--timeout` (seconds per
connect / handshake, default 8), `--count` (TCP connects per node, default 3), `--node NAME=IPv4`
(add a node), `--out` (summary path).

Tests: `python3 -m unittest discover -s tooling/ops/cn-acceptance -p 'test_*.py'`.
