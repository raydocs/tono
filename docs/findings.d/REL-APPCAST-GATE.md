| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| REL-APPCAST-GATE | Sparkle 手动发布和 dry-run 不跑 `verify-release-gate.sh`，签名只覆盖 zip 字节，未过门的包也能写进 feed | in-PR | 本 PR | 中·已确认 | 门跑在 `--app` 上。调用方仍可把另一份已过门的 app 和另一份已签 zip 配在一起。`release-macos.sh` 旧的六条 `ok:` 计数在今天的门脚本上不会单独放行，因为失败会少一条 `ok:`；现已改为看退出码。未实机 |

`macos-release.yml` 的 appcast 作业只 dry-run `publish-macos-appcast.mjs`，并让操作者去掉 `--dry-run` 再跑。那个脚本原先不调用发布门。构建作业只做了 `codesign --verify`、stapler 和 `spctl`，没有 helper 的 client requirement。
