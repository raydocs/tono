| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CBS-CP-01 | Shared-admin home PATCH can rename a bound catalog home to a fleet-retired node's name, bypassing the #1170 binding fence | fixed | branch `hunt/claude-be-home-rename-fence` | 低·已确认（P3） | Needs an administrator rename to a retired node's name. Bindings stored before this fix with such a name are not rewritten |

`homeExitsResource` PATCH (`services/control-plane/src/ops/shared-admin/home-exits.ts`) wrote `proxy_name` without the check `upsertHomeBinding` applies at bind time (`HOME_BINDABLE_SQL`, `home.ts`). The bound user's catalog then pointed at a node removed from the fleet. The UPDATE now refuses (409 `HOME_EXIT_INACTIVE`) when a bound catalog home takes a new name that a retired `ops_node_profiles` row holds. The check sits in the UPDATE's WHERE clause, so it also covers a retirement that commits concurrently. Edits that keep the name are unaffected.
