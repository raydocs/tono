# Mainland China network acceptance (one command)

Tool: [`tooling/ops/cn-acceptance/cn_acceptance.py`](../../tooling/ops/cn-acceptance/cn_acceptance.py)
(Python 3.8+, stdlib only, one file), how-to in zh/en:
[`tooling/ops/cn-acceptance/README.md`](../../tooling/ops/cn-acceptance/README.md). Ops task under
[plan-2026-09-11](plan-2026-09-11.md); not a ship gate by itself.

> **Simulation is not field evidence.** Results from the agent orb, a cloud VM, or Globalping /
> tcp.ping.pe probes are simulations: they are not China field evidence and never close a
> carrier row, a finding or a SHIP_PLAN gate. Only a run on a mainland China access network
> (home broadband or mobile data of China Mobile / Telecom / Unicom), done by the owner or a
> tester, with `identity.country` = `CN` in the summary, counts as field evidence.
>
> **模拟不是现场证据。** orb、云主机、Globalping / tcp.ping.pe 的结果都是模拟，不是中国现场证据，
> 不能用来关闭运营商结论、发现项或发布门。只有老板或测试者在大陆家宽 / 手机网络上跑、摘要里
> `identity.country` 为 `CN` 的结果才算现场证据。

## Run

The tester disconnects Tono and any VPN, then on the everyday network:

```sh
python3 cn_acceptance.py --label "上海 移动 家宽" --carrier cmcc     # Windows: py cn_acceptance.py ...
```

It needs no account and no secret, installs nothing, and writes
`tono-cn-acceptance-<UTC>.json` (schema `tono.cn-acceptance.v1`) to send back. The summary keeps
the public address only as its /24 (IPv6 /48), the ASN, organisation and city; no credential and
no local path. A run takes 1–5 minutes; every check has its own timeout (`--timeout`, default 8 s
per connect / handshake / answer) and every step a time budget, after which remaining checks are
`UNKNOWN step-timeout`.

Optional real hy2 handshake: `--hy2-auth-file` (a `0600` file with a dedicated test account UUID),
`--hy2-cert-dir` (`<node-ip>.pem` public leaf certificates) and `--hysteria` (official client).
The tool runs [`tooling/ops/hy2/hy2_probe.py`](../../tooling/ops/hy2/hy2_probe.py) per hy2 node and
hands it the credential file by path only; it never reads, prints or stores the credential.
`hy2_probe.py` refuses a certificate that does not hash to the repo's catalog fingerprint
(`insecure: false`, no skip-verify). It needs `os.getuid`, so the hy2 step runs on macOS / Linux.

## Checks and what they mean for customers

Every line is `PASS`, `FAIL` or `UNKNOWN` plus a code and a short reason. `UNKNOWN` means "this
run cannot tell" (blocked lookup, no IPv6 on the machine, local CA store missing, TCP intercepted
by the local network, step not run); it is never a pass.

| Id | Check | FAIL means for customers |
|---|---|---|
| 1 | Network identity via ipinfo.io, then api.ip.sb (best effort; `UNKNOWN` if blocked) | never FAIL; tells us which carrier / ASN / city the row belongs to |
| 2.1, 2.2 | System DNS for `api.afk.ccwu.cc`, `releases.afk.ccwu.cc`; every answer must be in Cloudflare's published ranges | `not-cloudflare`: the resolver is poisoned or hijacked. Clients still have the pinned addresses (3b) and the relays (3c), so it only hurts if those fail too; browsers on the download page do hit it |
| 3a | TLS (SNI `api.afk.ccwu.cc`, normal verification) + `GET /api/v1/health` to the system-DNS address | the client's `system_dns` path is dead |
| 3b.1, 3b.2 | Same to the pinned Cloudflare addresses 104.20.26.170, 172.66.162.98 | the client's `pinned` path is dead |
| 3c.1, 3c.2 | Same through the Tono relays 179.253.233.220:2053, 179.255.154.17:2053 ([api-relay.md](api-relay.md)) | the relay fallback is dead on this network |
| 4.1x | `GET https://releases.afk.ccwu.cc/desktop/v1/latest/manifest.json` (Windows updater and macOS native updater discovery) direct and via each relay | the updater cannot see a new version on that path. A `404 Not found` from the release host is `PASS no-manifest`: the path works, nothing is published there yet (true on 2026-10-10) |
| 4.2x | `GET https://api.afk.ccwu.cc/appcast.xml` (Sparkle feed of the published macOS line) direct and via each relay | macOS builds on Sparkle cannot see an update on that path |
| 5.0 | TCP control to 192.0.2.1:443 (RFC 5737, never routed) | `UNKNOWN tcp-intercepted` when it connects: the local network answers every TCP connect itself, so 5.1+ are `UNKNOWN` too |
| 5.1+ | TCP connect ×3 to each exit node's Reality port 443 (connect only, no data) | `tcp-blocked`: the node is unusable from this network; `tcp-lossy`: some connects fail; `PASS tcp-slow` (median ≥ 900 ms): connects only after a SYN retransmit, the China Mobile → CMI pattern in [transport-hy2.md](transport-hy2.md) |
| 5.h* | hy2 handshake ×3 per hy2 node via `hy2_probe.py` (only with a test credential) | `hy2-blocked` / `hy2-partial`: the UDP backup channel does not work here; `UNKNOWN not-run` without credential, client or certificate |
| 6.1 | AAAA for `api.afk.ccwu.cc` (must be Cloudflare) | poisoned AAAA |
| 6.2 | TLS + health over IPv6 | IPv6 to Cloudflare is broken on a network that has IPv6; `UNKNOWN no-route` when the machine has no IPv6 at all |

TLS failure codes: `tcp-timeout` (SYN unanswered: blocked or path down), `tcp-refused`,
`tls-reset` (reset in the handshake, typical of SNI filtering), `tls-eof`, `tls-timeout`,
`cert-invalid` (certificate not valid for the host with a working CA store: interception or a
wrong endpoint), `unexpected-body` (an HTTP 200 that is not the Tono answer: captive portal),
`cf-1010` (Cloudflare refused the client signature), `redirect`, `http-<status>`.

### Customer verdicts (`customer` in the JSON)

| Field | Values | Meaning |
|---|---|---|
| `signIn` | `direct` · `relay-only` · `blocked` · `unknown` | `direct`: any of 3a / 3b passed; every client signs in. `relay-only`: only 3c passed; only builds that carry the relay (decision 077; per [WIN-AUTH-CN-CF-PATH](../findings.d/WIN-AUTH-CN-CF-PATH.md) a first sign-in needs the release after 0.0.75) can sign in, and only while protection is not armed. `blocked`: no path; no build signs in from this network |
| `update` | same | as `signIn`, for update discovery (4.x). `relay-only`: only updaters with the relay fallback (Windows A1, macOS A2) see updates |
| `realityPorts` | `n/m PASS` | how many listed exit nodes accept TCP on 443 from here |
| `hy2` | `n/m PASS` or `not run` | real hy2 handshakes that passed |
| `dnsPoisoned` | bool | any DNS answer outside Cloudflare |
| `ipv6` | result of 6.2 | |
| `mainlandChinaVantage` | bool / null | `identity.country == "CN"`; `false` or `null` means the run is not China field evidence |

### Matrix for the client acceptance rows

The run ends with a `capability × path` matrix (also `checks[]` in the JSON, one object per
line: `id`, `capability`, `path`, `target`, `result`, `code`, `reason`, timings). Paths use the
client's `X-Tono-Path` names, so a row maps directly onto what the control plane records per
device:

| capability | path | client step |
|---|---|---|
| `signin` | `system_dns`, `pinned`, `relay` | sign-in / catalog fetch transport (Windows `transport.rs`, macOS `TonoAPIClient.exchangeOverPaths`) |
| `update` | `direct`, `relay` | updater discovery (Windows `commands/update.rs`, macOS `NativeUpdateDownload`, Sparkle feed) |
| `exit.reality` | `direct` | connect to a node (VLESS Reality, TCP 443) |
| `exit.hy2` | `direct` | manual / automatic hy2 backup channel (UDP 443) |
| `dns`, `ipv6` | `system_dns` | resolver health, IPv6 |

One row per carrier: the coordinator copies `label`, `carrier`, `identity.asn`, the `customer`
block and any `FAIL` lines into the acceptance record. Not covered here: DoH and the alternate
ports (clients try them after the relays), throughput, long-lived sessions, anything after the
tunnel is up.

## Exit node list

Only public IPv4 addresses already in this repository, never the private catalog sources:
the five Dedirock hy2 sources (`tooling/scripts/write-dedirock-hy2-catalog-sources.rb`: Niagara,
Erie, Sunset, Mesa 107.174.123.27, Grove — with their hy2 fingerprints), Marina
([transport-hy2.md](transport-hy2.md)), Westwood and Mesa 179.255.154.17 ([api-relay.md](api-relay.md)),
Sakura ([fleet report 2026-09-24](../reports/FLEET_EXIT_AGENT_ROLLOUT_2026-09-24.md)). The repo
names two addresses for "Mesa" (Dedirock, September; DMIT, October); both are checked and
labelled. Harbor, Canyon, Vista, Pacific, Neon, Fuji and JP-VLESS-Reality have no IP in the repo
and are not checked; add one with `--node "NAME=IPv4"`. The live catalog is the authority.

## 2026-10-10 orb run (simulation)

Run once from the agent orb (Google Cloud, The Dalles, Oregon, AS396982), label `orb, not CN`:
2.x, 3a–3c, 4.x `PASS` (manifest `no-manifest` 404 on every path, appcast 200), 5.0 `UNKNOWN`
(the orb answers every TCP connect locally, so all Reality rows are `UNKNOWN`), hy2 not run,
6.2 `UNKNOWN no-route`. The summary is attached to the PR that added the tool. **It is not China
field evidence**; it only shows the tool runs and that the paths work from a US cloud network.
