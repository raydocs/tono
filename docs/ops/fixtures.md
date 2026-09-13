# Ops 夹具采集

从本地 `wrangler dev` 拉一份真实形状的 GET `/api/v1/ops/*` 响应，脱敏后写进
`services/ops-console/fixtures/captured/`。合同检查器在 Worker 出站时跑一遍，
控制台测试再对提交的 JSON 跑同一组 `assert*`，两边对不上会红。

Access 在生产是 Cloudflare Access JWT。本地用 `wrangler.fixtures.jsonc`：入口
`preview/fixtures-entry.ts` 把 JWKS 回在本 isolate，采集脚本默认签发对应的
`cf-access-jwt-assertion`。不要把这份配置拿去部署。

## 命令

工作目录：`services/control-plane`。D1 用默认本地 persist，和 `wrangler dev` 同一份。

```sh
npx wrangler d1 migrations apply tono-control-plane --local --config wrangler.fixtures.jsonc

# 普通：preview 种子 + 各 GET {id} 所需的一行
node ../../tooling/scripts/capture-ops-fixtures.mjs --help
node preview/write-seed.mjs --output /tmp/tono-ops-seed-normal.sql
node -e "import { extrasSql } from './preview/write-seed-dense.mjs'; process.stdout.write(extrasSql())" > /tmp/tono-ops-seed-extras.sql
cat /tmp/tono-ops-seed-normal.sql /tmp/tono-ops-seed-extras.sql > /tmp/tono-ops-seed.sql
npx wrangler d1 execute tono-control-plane --local --config wrangler.fixtures.jsonc --file /tmp/tono-ops-seed.sql --yes

npx wrangler dev --config wrangler.fixtures.jsonc --port 8787 --persist-to .wrangler/state
```

另开一个终端：

```sh
node ../../tooling/scripts/capture-ops-fixtures.mjs \
  --base http://127.0.0.1:8787 \
  --out ../ops-console/fixtures/captured/normal \
  --freeze-now 1725000000 \
  --scenario normal
```

密集场景（45 个长中文名节点、60 个客户、400 条连接事件、12 条事故）：

```sh
node preview/write-seed-dense.mjs --output /tmp/tono-ops-seed-dense.sql
npx wrangler d1 execute tono-control-plane --local --config wrangler.fixtures.jsonc --file /tmp/tono-ops-seed-dense.sql --yes
# 重启 wrangler dev 后再采
node ../../tooling/scripts/capture-ops-fixtures.mjs \
  --base http://127.0.0.1:8787 \
  --out ../ops-console/fixtures/captured/dense \
  --freeze-now 1725000000 \
  --scenario dense
```

`--scenario dense` 也会在采集前把 dense SQL 打进本地 D1；若 wrangler 已经起来，
重启一次再 GET，避免读到启动时的快照。已有 Access 断言时加
`--access-header 'cf-access-jwt-assertion: <jwt>'`。

输出是 `<route 斜杠改成横杠>.json` 和列出 route → file → checker 的 `index.json`。
`fleet-nodes` 与 `live` 是合同前的旧接口，checker 为 `passthrough`。
