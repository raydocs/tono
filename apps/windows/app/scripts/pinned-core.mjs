import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// This is an identity/packaging gate, not a signature or provenance verifier.
// Provenance comes from the pinned-source build and same-run CI artifact.
export function validateCoreVersion(output, identity) {
  const lines = output.trim().split(/\r?\n/)
  const expected = `Mihomo Meta ${identity.tonoCoreVersion} windows amd64 with ${identity.goVersion} `
  if (!identity.tonoCoreVersion || !identity.goVersion || !lines[0]?.startsWith(expected)) {
    throw new Error('Windows Core version/platform/toolchain does not match core-identity.json')
  }
  const tags = lines.find((line) => line.startsWith('Use tags: '))?.slice(10).trim().split(/\s+/).sort()
  if (!Array.isArray(identity.buildTags) || identity.buildTags.length === 0 ||
      JSON.stringify(tags) !== JSON.stringify([...identity.buildTags].sort())) {
    throw new Error('Windows Core build tags do not match core-identity.json')
  }
}

export function verifyPinnedWindowsCore(binary, identityPath) {
  const identity = JSON.parse(readFileSync(identityPath, 'utf8'))
  const output = execFileSync(binary, ['-v'], { encoding: 'utf8', timeout: 15000, windowsHide: true })
  validateCoreVersion(output, identity)
  return output.trim()
}
