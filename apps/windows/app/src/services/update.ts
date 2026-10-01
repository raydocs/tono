import { Channel, invoke } from '@tauri-apps/api/core'
import type { DownloadEvent } from '@tauri-apps/plugin-updater'

type VersionParts = {
  main: bigint[]
  pre: (bigint | string)[]
}

const SEMVER_FULL_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

const normalizeVersion = (input: string | null | undefined): string | null => {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  return trimmed.replace(/^v/i, '')
}

const ensureSemver = (input: string | null | undefined): string | null => {
  const normalized = normalizeVersion(input)
  if (!normalized) return null
  return SEMVER_FULL_REGEX.test(normalized) ? normalized : null
}

const splitVersion = (version: string | null): VersionParts | null => {
  if (!version) return null
  const withoutBuildMetadata = version.split('+', 1)[0]
  const separator = withoutBuildMetadata.indexOf('-')
  const mainPart =
    separator < 0
      ? withoutBuildMetadata
      : withoutBuildMetadata.slice(0, separator)
  const preRelease =
    separator < 0 ? undefined : withoutBuildMetadata.slice(separator + 1)
  const main = mainPart.split('.').map((part) => BigInt(part))

  const pre =
    preRelease?.split('.').map((token) => {
      return /^\d+$/.test(token) ? BigInt(token) : token
    }) ?? []

  return { main, pre }
}

const compareVersionParts = (a: VersionParts, b: VersionParts): number => {
  const length = Math.max(a.main.length, b.main.length)
  for (let i = 0; i < length; i += 1) {
    const aPart = a.main[i] ?? 0n
    const bPart = b.main[i] ?? 0n
    if (aPart !== bPart) return aPart > bPart ? 1 : -1
  }

  if (a.pre.length === 0 && b.pre.length === 0) return 0
  if (a.pre.length === 0) return 1
  if (b.pre.length === 0) return -1

  const preLen = Math.max(a.pre.length, b.pre.length)
  for (let i = 0; i < preLen; i += 1) {
    const aToken = a.pre[i]
    const bToken = b.pre[i]
    if (aToken === undefined) return -1
    if (bToken === undefined) return 1

    if (typeof aToken === 'bigint' && typeof bToken === 'bigint') {
      if (aToken > bToken) return 1
      if (aToken < bToken) return -1
      continue
    }

    if (typeof aToken === 'bigint') return -1
    if (typeof bToken === 'bigint') return 1

    if (aToken > bToken) return 1
    if (aToken < bToken) return -1
  }

  return 0
}

export const compareVersions = (
  a: string | null,
  b: string | null,
): number | null => {
  const partsA = splitVersion(ensureSemver(a))
  const partsB = splitVersion(ensureSemver(b))
  if (!partsA || !partsB) return null
  return compareVersionParts(partsA, partsB)
}

// Release builds set this only after prepare-updater-config.mjs has injected the Tono-owned
// endpoint and public key. Developer builds therefore never query any inherited channel.
export const TONO_UPDATES_CONFIGURED =
  import.meta.env.VITE_TONO_UPDATES_CONFIGURED === 'true'

export interface UpdateOffer {
  version: string
  manifestSha256: string
  body?: string
}

export const checkUpdateSafe = async (): Promise<UpdateOffer | null> => {
  if (!TONO_UPDATES_CONFIGURED) return null
  // The native Service verifies the detached signature and releaseSequence.
  // A version label or a legacy feed cannot authorize this path.
  return invoke<UpdateOffer | null>('tono_check_update')
}

export const installUpdate = async (
  manifestSha256: string,
  onDownloadEvent: (event: DownloadEvent) => void,
): Promise<void> => {
  const progress = new Channel<DownloadEvent>()
  progress.onmessage = onDownloadEvent
  return invoke<void>('tono_install_update', { manifestSha256, progress })
}
