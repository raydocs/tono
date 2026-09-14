import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// This is an identity/packaging gate, not a signature or provenance verifier.
// Provenance comes from the pinned-source build and same-run CI artifact.
export function validateCoreVersion(output, identity) {
  const lines = output.trim().split(/\r?\n/)
  if (identity.engine !== 'sing-box' || !identity.tonoCoreVersion || !identity.goVersion ||
      lines[0] !== `sing-box version ${identity.tonoCoreVersion}` ||
      !lines.includes(`Environment: ${identity.goVersion} windows/amd64`) ||
      !lines.includes(`Revision: ${identity.upstreamCommit}`) ||
      !lines.includes('CGO: disabled')) {
    throw new Error('Windows Core version/platform/toolchain does not match core-identity.json')
  }
  const tags = lines.find((line) => line.startsWith('Tags: '))?.slice(6).trim().split(',').sort()
  if (!Array.isArray(identity.buildTags) || identity.buildTags.length === 0 ||
      JSON.stringify(tags) !== JSON.stringify([...identity.buildTags].sort())) {
    throw new Error('Windows Core build tags do not match core-identity.json')
  }
}

export function verifyPinnedWindowsCore(binary, identityPath) {
  const identity = JSON.parse(readFileSync(identityPath, 'utf8'))
  // Authenticate bytes before executing even a version command. A matching banner
  // alone is neither identity nor permission to run an arbitrary downloaded exe.
  const measured = createHash('sha256').update(readFileSync(binary)).digest('hex')
  if (!/^[0-9a-f]{64}$/.test(identity.binarySha256) || measured !== identity.binarySha256) {
    throw new Error('Windows Core SHA-256 does not match core-identity.json')
  }
  const output = execFileSync(binary, ['version'], { encoding: 'utf8', timeout: 15000, windowsHide: true })
  validateCoreVersion(output, identity)
  return output.trim()
}
