# 控制面 D1 备份

生产库 `tono-control-plane` 里是账号、目录修订、诊断索引和用量汇总。Cloudflare 自己的 D1 快照不是一条我们能执行的恢复路径，所以每晚把一份 SQL 导出放到我们能读回来的对象上。

## 备份什么、放到哪里

| | |
| --- | --- |
| 源 | 生产 D1 `tono-control-plane`（`services/control-plane/wrangler.jsonc`） |
| 脚本 | `tooling/scripts/backup-control-plane-d1.sh` |
| 工作流 | `.github/workflows/control-plane-d1-backup.yml`（每天 03:17 UTC，也可 `workflow_dispatch`） |
| 目的 | R2 桶 `tono-releases`（Worker 绑定 `RELEASES`） |
| 对象键 | `backups/control-plane-d1/<UTC日期>T<时间>Z.sql.gz`，旁路 `*.sql.gz.sha256` |

备份只走 Cloudflare：工作流**不会**把 dump 传到 GitHub Actions artifacts。导出小于 10 KiB 视为失败——真库是数 MB，低于这个地板的几乎一定是空文件、截断或 Wrangler 写出来的错误页，上传它等于备份了一次「成功的空库」。

本地只导出、不上传：

```sh
tooling/scripts/backup-control-plane-d1.sh --dry-run --keep-local /tmp/tono-d1-backup
```

CI 使用仓库密钥 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。笔记本可以用 `wrangler login`，不要把 token 打进终端或脚本日志。

## 保留期

脚本**不能**配置 R2 生命周期。必须在 Cloudflare 控制台给桶 `tono-releases` 加上一条 **90 天** 的生命周期规则，前缀限定为 `backups/`。

不要对整个桶生效：同一桶里还有安装包，那些对象必须留下。规则只覆盖 `backups/`。

## 恢复到 preview

恢复目标固定为隔离库 `tono-control-plane-ops-preview`（见 `services/control-plane/preview/README.md`）。`tooling/scripts/restore-control-plane-d1-preview.sh` 把生产库名 `tono-control-plane` 写死为拒绝名单，不会对生产执行 `d1 execute`。

`wrangler d1 execute --file` 往已有 schema 上重放整份 dump 会撞表。演练前先删掉并重建 **preview 自己的** D1，不要动生产库。

```sh
# 对象键可以是完整 key 或文件名。
tooling/scripts/restore-control-plane-d1-preview.sh \
  backups/control-plane-d1/2026-09-09T03:17:05Z.sql.gz
```

脚本会下载 `.sql.gz` 和 `.sha256` 旁路、核对哈希、解压，再导入 preview。哈希对不上就停，不会导入。

## 季度恢复演练清单

每季度做一次，记下日期。目标是证明「能从 R2 拿回来、能进 preview、脚本仍拒绝生产库」，不是把 preview 变成生产副本。

1. 在 Cloudflare R2 `tono-releases` 的 `backups/control-plane-d1/` 下确认最近一次 nightly 对象和它的 `.sha256` 都在，且早于 90 天的对象已被生命周期删掉（或记下规则尚未生效）。
2. 确认隔离 preview D1 `tono-control-plane-ops-preview` 仍在；若 schema 已脏，**只**删除并重建这个 preview 库，不要对 `tono-control-plane` 做任何删除或导入。
3. 运行 `restore-control-plane-d1-preview.sh`，指向第 1 步的对象键。哈希失败或导入失败则停，不要改用生产库名重试。
4. 在 preview 上抽查：`sqlite_master` 表数量、`users` / 目录修订等非密钥行数是否大致说得通。不要把生产密钥、邮件正文或加密目录行拷到别处。
5. 故意对恢复脚本传入生产库名或确认脚本源码里 `PRODUCTION_D1_NAME` 仍会拒绝 `tono-control-plane`；这一项必须失败。
6. 演练结束后如需干净 preview，按 `preview/README.md` 重新 seed，不要把刚导入的生产数据留在可被 Access 登录看到的 preview 上过久。
7. 把演练日期、所用对象键、通过/失败写进 ops 记录。失败则修脚本或权限，不要把「没练」当成备份存在的证据。
