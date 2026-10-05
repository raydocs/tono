/**
 * Version edits for Cargo files. No CLI and no file access here, so
 * release-version.mjs stays a thin caller and the edits can be tested.
 * Both edits change one value and nothing else: spacing, comments and line
 * endings stay as they were.
 */

const MULTILINE_DELIMITERS = ['"""', "'''"]

/**
 * Set `version` in the `[package]` table. A `version = ...` line in any other
 * table, inside a multi-line string or in a comment is left alone. A version
 * that is not a plain string (inherited from the workspace) is refused.
 * @param {string} toml
 * @param {string} version
 * @returns {string}
 */
export function setCargoPackageVersion(toml, version) {
  let inPackage = false
  let openString = null
  let replaced = false
  const lines = toml.split('\n').map((line) => {
    if (openString) {
      if (line.includes(openString)) openString = null
      return line
    }
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) {
      inPackage = trimmed.replace(/\s*#.*$/, '') === '[package]'
      return line
    }
    for (const delimiter of MULTILINE_DELIMITERS) {
      if (line.split(delimiter).length === 2) openString = delimiter
    }
    if (!inPackage || !/^version\s*[.=]/.test(trimmed)) return line
    const plain = /^(\s*version\s*=\s*")[^"]*(".*)$/s.exec(line)
    if (!plain || replaced) {
      throw new Error('Cargo.toml [package] version is not one plain string')
    }
    replaced = true
    return `${plain[1]}${version}${plain[2]}`
  })
  if (!replaced) throw new Error('Cargo.toml has no [package] version')
  return lines.join('\n')
}

/**
 * Set the version of the local package `name` in Cargo.lock: the one entry
 * without a `source`. `cargo metadata --locked` refuses a lock that still
 * carries the old version. A lock that refers to the package together with
 * its version (`"name 1.2.3"`) is refused: that reference would dangle.
 * @param {string} lock
 * @param {string} name
 * @param {string} version
 * @returns {string}
 */
export function setCargoLockVersion(lock, name, version) {
  const lines = lock.split('\n')
  const entries = []
  let entry = null
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('[')) {
      entry = line === '[[package]]' ? {} : null
      if (entry) entries.push(entry)
    } else if (line.trim().startsWith(`"${name} `)) {
      throw new Error(`Cargo.lock refers to ${name} with a version`)
    } else if (entry && line === `name = "${name}"`) {
      entry.named = true
    } else if (entry && line.startsWith('version = "')) {
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
  const index = local[0].versionLine
  lines[index] = lines[index].replace(/"[^"]*"/, `"${version}"`)
  return lines.join('\n')
}
