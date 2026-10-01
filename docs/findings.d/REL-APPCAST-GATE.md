| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| REL-APPCAST-GATE | Sparkle 手动发布和 dry-run 不跑 `verify-release-gate.sh`，签名只覆盖 zip 字节，未过门的包也能写进 feed | in-PR | [#939](https://github.com/raydocs/tono/pull/939) | 中·已确认 | 门现在跑在从这份 zip 解出的 Tono.app 上，且该树必须与 `--app` 逐文件字节相同。`release-macos.sh` 已改看退出码。未实机。资源叉不参与字节比较 |

`macos-release.yml` 的 appcast 作业只 dry-run `publish-macos-appcast.mjs`，并让操作者去掉 `--dry-run` 再跑。那个脚本原先不调用发布门。构建作业只做了 `codesign --verify`、stapler 和 `spctl`，没有 helper 的 client requirement。续修：发布门改跑在 zip 里的 `Tono.app` 上，`--app` 必须与之逐文件字节相同，不能再拿另一份包顶替。
