# Tono for Windows

Cloud-managed Tono client: Tauri UI, LocalSystem service, fail-closed WFP.

Download signed installers only from
[raydocs/tono releases](https://github.com/raydocs/tono/releases).
The updater reads the Tono-owned `windows-updates` feed, not any third-party channel.

## Development

See the Windows section of the repository [CONTRIBUTING.md](../../../CONTRIBUTING.md).

```shell
pnpm i
pnpm run prebuild
pnpm dev
```

`pnpm dev` keeps the existing Development Channel service state. Use
`pnpm dev:service` to install or update that service, or `pnpm dev:sidecar`
only when diagnosing the unprivileged path (Tono product builds require the
service).

## License

GPL-3.0. See [LICENSE](./LICENSE).
