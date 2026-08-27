# Isolated operations-preview runbook

This directory is a **local-only preparation**. Rendering configuration and
emitting synthetic SQL make no Cloudflare request. Do not create resources,
apply a remote migration, set a secret, or deploy until a human explicitly
approves the remote-change list below.

## Isolation design

| Surface | Preview design | Production isolation |
| --- | --- | --- |
| API Worker | `tono-control-plane-ops-preview`, `workers_dev: false`, no route | Not publicly reachable; only the preview admin service binding can invoke it. |
| Admin Worker | `tono-admin-ops-preview`, one new hostname selected in `.preview.env` | The renderer rejects existing production hosts and every `*.afk.ccwu.cc` hostname except a unique `ops-preview-<commit>.afk.ccwu.cc` name. |
| D1 | `tono-control-plane-ops-preview` | A new database ID is required; the renderer accepts only a UUID supplied from the ignored local file. |
| Service binding | `API -> tono-control-plane-ops-preview` | It cannot point at the production API name. |
| R2 | Two empty buckets under `tono-ops-preview-*` | The renderer refuses non-preview bucket names; do not copy production objects. |
| Access | One new self-hosted application for the new admin hostname | Separate audience, explicit preview-only Allow policy, no production-policy edit. |
| External integrations | Tailnet enrollment disabled; mail/OIDC configuration blank | No production tailnet, mail, OAuth, collector, or customer input is reused. |

Cloudflare service bindings support an internal Worker with no public URL, and
hostname-based Access can protect a distinct custom hostname. The admin Worker
continues forwarding the Access assertion for its API request; the API performs
its own existing assertion verification.

## Production migrations 0026–0028

Do **not** apply `0026`, `0027`, or `0028` to the shared production D1
`tono-control-plane` from this branch.

Those three files exist on `ops-console-90` / `raydocs/ops-console-preview`.
They are not on `origin/main`. The live API/admin Workers currently run an
older `main` SHA. Applying `0028` on the production database would install
the writer-v2 fence while the running Worker still uses the pre-v2 rollup
writer; retention would start failing before any authorized production
deploy. Production schema changes go through
`tooling/scripts/deploy-control-plane-main.sh` on a clean `main` that matches
`origin/main`.

`0029` is not created and `0028` is not rewritten. Committed migrations stay
immutable. An additive `0029` is only warranted if a remote ledger already
records `0028` while marker columns or
`operations_agent_rollups_require_writer_v2` are missing. Production currently
shows `0028` **pending**, which matches an unfenced schema.

The isolated preview D1 is the database that received 0001–0028.

## Expected remote changes — approval gate

Preview storage that has already been created after explicit approval:

1. D1 `tono-control-plane-ops-preview` — created; migrations 0001–0028 applied;
   synthetic seed applied.
2. Empty R2 buckets `tono-ops-preview-diagnostics` and
   `tono-ops-preview-releases` — created; production objects were not copied.

Still required before a public preview hostname exists:

3. Reserve one unused `ops-preview-<commit>.afk.ccwu.cc` hostname for the admin
   Worker. `afk.ccwu.cc` is a delegated Cloudflare zone; this is a new dedicated
   child hostname, not an existing production custom domain. Creating it adds
   only that hostname's DNS/certificate route and must not replace an existing
   route. The renderer refuses every other `*.afk.ccwu.cc` hostname.
4. Create a new Cloudflare Access self-hosted application for exactly that
   hostname with a separate audience and a least-privilege preview-only Allow
   policy. Wrangler OAuth cannot write Access applications; this step is
   dashboard or an API token with `Access: Apps and Policies Write`. Do not
   modify any production Access application or policy.
5. Put the new application's team domain, audience, and operator allowlist on
   **both** preview Workers, then deploy the admin Worker with the same
   `BUILD_SHA` already used for the private API Worker. Do not apply 0026–0028
   to production as part of this preview.

The private API Worker may be deployed first (`workers_dev: false`, no route).
Do not attach the admin custom domain until step 4 exists; otherwise the
hostname is public without an Access login wall.

The Access administrator address is an operator secret/configuration value. It
belongs only in `ACCESS_ADMIN_EMAILS` through `wrangler secret put`; it is never
added to this repository or to the seed data.

## Commands to run only after approval

Use the authorized Wrangler profile without printing its credential. Replace
only resource identifiers in the ignored local file; never put secret values on
a command line.

```sh
# Creates the three isolated storage resources (remote writes).
npx wrangler d1 create tono-control-plane-ops-preview --profile "$CLOUDFLARE_PROFILE"
npx wrangler r2 bucket create tono-ops-preview-diagnostics --profile "$CLOUDFLARE_PROFILE"
npx wrangler r2 bucket create tono-ops-preview-releases --profile "$CLOUDFLARE_PROFILE"

# Copy the D1 ID and approved hostname into this ignored file, then render only
# local config files in the control-plane directory.
cp preview/preview.env.example .preview.env
npm run preview:render-config -- --env-file .preview.env --output-dir .
```

Create the Access application in **Zero Trust → Access → Applications** before
deploying the admin hostname. It must target the one hostname from
`.preview.env`, be deny-by-default, and contain only the named preview operator
Allow rule. Put its team domain, audience, and operator allowlist in the three
Access secrets on **both** Workers. The API needs fresh preview-only
`JWT_SECRET`, `ADMIN_API_TOKEN`, `HOME_AGENT_TOKEN`, and
`CATALOG_ENCRYPTION_KEY`; do not set Tailscale, Resend, or production secrets.

```sh
# Interactive prompts only; do not echo or paste secret values into shell history.
for secret in JWT_SECRET ADMIN_API_TOKEN HOME_AGENT_TOKEN CATALOG_ENCRYPTION_KEY \
  ACCESS_TEAM_DOMAIN ACCESS_AUD ACCESS_ADMIN_EMAILS; do
  npx wrangler secret put "$secret" --config wrangler.preview.generated.jsonc --profile "$CLOUDFLARE_PROFILE"
done
for secret in ACCESS_TEAM_DOMAIN ACCESS_AUD ACCESS_ADMIN_EMAILS; do
  npx wrangler secret put "$secret" --config wrangler.preview.admin.generated.jsonc --profile "$CLOUDFLARE_PROFILE"
done

# The migration target is the new D1 binding in the generated preview config.
npx wrangler d1 migrations apply tono-control-plane-ops-preview --remote \
  --config wrangler.preview.generated.jsonc --profile "$CLOUDFLARE_PROFILE"
npm run preview:seed -- --output /tmp/tono-ops-preview-seed.sql
npx wrangler d1 execute tono-control-plane-ops-preview --remote \
  --config wrangler.preview.generated.jsonc --file /tmp/tono-ops-preview-seed.sql \
  --profile "$CLOUDFLARE_PROFILE"

npm run admin:build
BUILD_SHA="$(git rev-parse HEAD)"
npx wrangler deploy --config wrangler.preview.generated.jsonc \
  --var "BUILD_SHA:$BUILD_SHA" --profile "$CLOUDFLARE_PROFILE"
npx wrangler deploy --config wrangler.preview.admin.generated.jsonc \
  --var "BUILD_SHA:$BUILD_SHA" --profile "$CLOUDFLARE_PROFILE"
```

The API must deploy before the admin Worker because the latter's service binding
requires its target to exist. Do not substitute the production deploy script or
either existing Wrangler config for these commands.

After Access login, validate the same-origin preview endpoint
`/api/v1/ops/system/version`: it must report two valid, equal 40-character SHAs
and `aligned: true`. A missing or `development` SHA is a failed preview.

## Synthetic scenarios and rollback

`npm run preview:seed` contains only `@example.test` addresses and RFC 5737
documentation IPv4 ranges. It seeds a synthetic unhealthy Seoul node, customer
drawers, and raw/5-minute/hourly metric tiers. It intentionally does not seed
encrypted catalog or traffic-policy rows. After Access login, use the protected
preview Control UI to publish `catalog.synthetic.yaml`, then publish
`traffic-policy-v4.synthetic.json`. The catalog has only documentation endpoint
addresses; the v4 policy contains no IP endpoint and its one allowlisted web
host is used only to exercise the "关闭网页直连" UI path, never by a preview
client. These two first writes exercise revision conflict behavior and make the
synthetic Seoul incident catalog-listed.

To exercise a partial source failure after approval, apply the emitted scenario
to the preview D1 and then manually refresh the console. Re-run the normal seed
to restore it.

```sh
npm run preview:seed -- --scenario partial-source-failure --output /tmp/tono-ops-preview-partial-source.sql
npx wrangler d1 execute tono-control-plane-ops-preview --remote \
  --config wrangler.preview.generated.jsonc --file /tmp/tono-ops-preview-partial-source.sql \
  --profile "$CLOUDFLARE_PROFILE"
```

There is no migration rollback for a preview database: if an isolated preview
schema is unusable, delete and recreate **only its own** D1/R2/Workers/Access
resources after explicit approval. Never remove the rollup writer fence from a
shared database as a recovery action.
