/**
 * Version edits for Cargo files. No CLI and no file access here, so
 * release-version.mjs stays a thin caller and the edits can be tested.
 */

/**
 * Set `version` in the `[package]` table. A `version = ...` line in any other
 * table (a dependency written as its own table) is left alone.
 * @param {string} toml
 * @param {string} version
 * @returns {string}
 */
export function setCargoPackageVersion(toml, version) {
  let inPackage = false
  let replaced = false
  const lines = toml.split('\n').map((line) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) {
      inPackage = trimmed === '[package]'
      return line
    }
    if (!inPackage || replaced || !/^version\s*=/.test(trimmed)) return line
    replaced = true
    return line.replace(/version\s*=\s*"[^"]*"/, `version = "${version}"`)
  })
  if (!replaced) throw new Error('Cargo.toml has no [package] version')
  return lines.join('\n')
}

/**
 * Set the version of the local package `name` in Cargo.lock: the one entry
 * without a `source`. `cargo metadata --locked` refuses a lock that still
 * carries the old version.
 * @param {string} lock
 * @param {string} name
 * @param {string} version
 * @returns {string}
 */
export function setCargoLockVersion(lock, name, version) {
  const lines = lock.split('\n')
  const entries = []
  let entry = null
  for (const [index, line] of lines.entries()) {
    if (line.startsWith('[')) {
      entry = line === '[[package]]' ? {} : null
      if (entry) entries.push(entry)
    } else if (entry && line === `name = "${name}"`) {
      entry.named = true
    } else if (entry && line.startsWith('version = ')) {
      entry.versionLine = index
    } else if (entry && line.startsWith('source = ')) {
      entry.hasSource = true
    }
  }
  const local = entries.filter(
    (candidate) =>
      candidate.named &&
      !candidate.hasSource &&
      candidate.versionLine !== undefined,
  )
  if (local.length !== 1) {
    throw new Error(
      `Cargo.lock must contain exactly one local ${name} package, found ${local.length}`,
    )
  }
  lines[local[0].versionLine] = `version = "${version}"`
  return lines.join('\n')
}
