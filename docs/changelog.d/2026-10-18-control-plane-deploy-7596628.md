## 2026-10-18 · 控制面部署 main@7596628（家宽出口查询）
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md) 控制台；所有者 2026-10-18「自动合并 然后你部署」。
- 来源：main `7596628e4`（#1681 合并提交）。本次上线的是 [2026-10-18-home-egress-lookup.md](2026-10-18-home-egress-lookup.md)。
- 缺陷修复：无。
- 新增/优化：见上述条目（`POST/GET home-exits/…/egress`、表 `home_exit_egress`、控制台「出口」列）。
- 工程与测试：#1681 的 Codex 审查记录与验证见 PR 评论；ci-gate 在 `03952fd37` 通过后由 auto-merge 合入。部署脚本内 `npm test` 65 个文件 1047 个用例通过。
- 验证：部署前 D1 导出 `2026-10-18T20:22:51Z.sql.gz`（8.3 MB，SHA-256 `3b4ee56c349f2e51f3d52143c37fcef8df87417f843a3143a8a055e874b0fdce`），与 `.sha256` 一起上传
  `tono-releases/backups/control-plane-d1/`。迁移 0102（和 preview 落后的 0101）先在 `tono-control-plane-ops-preview` 演练通过，再由脚本应用到生产。
  API Worker `tono-control-plane-staging` 版本 `6268e641-1fdf-4eb2-878a-764c305972f5`，admin `tono-admin-production` `5529cbdf-ba18-4cca-be0f-ecbd7b579c23`；
  `/api/v1/system/version` buildSha `7596628e4…`。线上实测 `POST home-exits/{decodo 10078}/egress`：200，972 ms，经线路回显 `48.45.90.215`，响应不含口令。
- 候选/发布：无新包。
- 剩余限制：从 Worker 出口问定位库，9 家里 5 家被共享出口 IP 的额度挡住（ipinfo / ipwho.is / ipapi.co 429，freeipapi 403，db-ip 当日额度用尽），
  只有 ip-api、ipapi.is、geojs、country.is 有答复；多数地点只由 2 家投出。
