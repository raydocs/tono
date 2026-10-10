/**
 * The control-plane paths a failed sign-in tried, read from the transport's combined message.
 *
 * The Rust transport writes every path that ran in the macOS client's wording (#1464),
 * `label[<ms>ms <detail>]` joined by `; `, e.g.
 * `pinned[10012ms connect: ...]; system_dns[30001ms timeout: ...]; relay[4003ms 203.0.113.1:2053: connect: ...]`
 * (`tono_core::auth::path_failure`). Only the label, the elapsed milliseconds and the leading
 * classification word are read; the rest of the detail can carry request URLs and never leaves
 * this parser.
 */
type ControlPlanePathLabel = 'system_dns' | 'pinned' | 'relay'
type ControlPlaneFailureKind = 'dns' | 'connect' | 'tls' | 'timeout' | 'other'

export interface ControlPlanePathFailure {
  label: ControlPlanePathLabel
  kind: ControlPlaneFailureKind
  elapsedMs: number
}

// A relay's failure names its address (`203.0.113.1:2053: `) before the classification.
const PATH_FAILURE =
  /(?:^|\]; )(system_dns|pinned|relay)\[(\d{1,9})ms (?:\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}: )?(?:TONO_CLOCK_SKEW: )?(?:(dns|connect|tls|timeout|other): )?/g

/** Every path in the combined message, in the order they ran. Empty for any other text. */
export const controlPlanePathFailures = (
  transport: string,
): ControlPlanePathFailure[] =>
  Array.from(transport.matchAll(PATH_FAILURE), (match) => ({
    label: match[1] as ControlPlanePathLabel,
    kind: (match[3] ?? 'other') as ControlPlaneFailureKind,
    elapsedMs: Number(match[2]),
  }))

/** The copied diagnostics line: the same grammar with only the allowlisted tokens. */
export const controlPlanePathsSummary = (paths: ControlPlanePathFailure[]) =>
  paths
    .map(({ label, kind, elapsedMs }) => `${label}[${elapsedMs}ms ${kind}]`)
    .join('; ')
