# Tono for Windows — app workspace

The Tauri/React app is one part of the Tono Windows client. Its privileged
service owns WFP, DNS and Core lifecycle; browser-only UI and unprivileged
sidecar modes do not provide Tono's protection contract.

- [Windows architecture and development](../README.md)
- [App contribution workflow](CONTRIBUTING.md)
- [Repository execution policy](../../../docs/BUILD_AND_TEST.md)
- [Third-party notices](../../../THIRD_PARTY_NOTICES.md)

## Frontend-only work

From this directory, use the package-manager version pinned in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm web:dev
```

This starts Vite, not Tauri, and cannot certify native IPC or service behavior.
Use focused `pnpm typecheck`, `pnpm lint` and `pnpm test -- <test-file>` checks
as appropriate. Do not install dependencies just to edit documentation.

## Native development and candidates

`pnpm dev`, `pnpm dev:tauri`, `pnpm build`, prebuild downloads and native Rust
checks belong on a designated build machine or hosted CI, not automatically
on the maintainer's MacBook. Service installation is a separate privileged
operation. Do not use `dev:sidecar` to bypass a missing service or call it a
Tono product test.

Ordinary CI and candidate/release workflows have different prerequisites.
Follow [Windows development](../README.md#development) and the existing
workflows rather than copying upstream bootstrap commands. A GitHub release
asset is not automatically customer-channel approved; see [ship gates](../../../docs/SHIP_PLAN.md).

## License

GPL-3.0. See [LICENSE](LICENSE) and the repository third-party notices.
