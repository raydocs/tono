| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CR6e71-sign-nsis-copies | `desktop-update-sign.yml` 的 windows-verify 按文件名递归查找并要求 `tono-service.exe` 只有一份，而 #658 之后的真实 NSIS 安装包还带 `$PLUGINSDIR/tono-gate/resources/` 预安装门副本，签名会拒绝每一个真实正式安装包 | in-PR | [#665](https://github.com/raydocs/tono/pull/665) | 中·已确认 | 修复按安装路径取组件（`Tono.exe.next`、`tono-core.exe.next`、`resources/tono-service.exe`），同名其它副本必须逐字节相同，否则拒绝；新 workflow 仍未派发；`windows-candidate.yml` 的配对候选测量步骤用同样的按名查找，未改 |

来源：合并回归审查 6e71164d（#661 批次）确认的 major。真实 0.0.74 7401 安装包（windows-release run 36251483271，artifact
`windows-release-payload-e2aff1a3…`）用 7-Zip 解出：`resources/` 与 `$PLUGINSDIR/tono-gate/resources/` 各有一份
`tono-service.exe`、`tono-service-install.exe`、`tono-service-uninstall.exe`、`core-sha256.txt`、`core-identity.json`，两份逐字节相同；
`Tono.exe.next`、`tono-core.exe.next` 各一份。
