/**
 * CLI tool to update version numbers in package.json, src-tauri/Cargo.toml, Cargo.lock, and src-tauri/tauri.conf.json.
 *
 * Usage:
 *   pnpm release-version <version>
 *
 * <version> can be:
 *   - A full semver version (e.g., 1.2.3, v1.2.3, 1.2.3-beta, v1.2.3+build)
 *   - A tag: "alpha", "beta", "rc", "autobuild", "autobuild-latest", or "deploytest"
 *     - "alpha", "beta", "rc": Appends the tag to the current base version (e.g., 1.2.3-beta)
 *     - "autobuild": Appends a timestamped autobuild tag (e.g., 1.2.3+autobuild.2406101530)
 *     - "autobuild-latest": Appends an autobuild tag with latest Tauri commit (e.g., 1.2.3+autobuild.0614.a1b2c3d)
 *     - "deploytest": Appends a timestamped deploytest tag (e.g., 1.2.3+deploytest.2406101530)
 *
 * Examples:
 *   pnpm release-version 1.2.3
 *   pnpm release-version v1.2.3-beta
 *   pnpm release-version beta
 *   pnpm release-version autobuild
 *   pnpm release-version autobuild-latest
 *   pnpm release-version deploytest
 *
 * The script will:
 *   - Validate and normalize the version argument
 *   - Update the version field in package.json
 *   - Update the [package] version in src-tauri/Cargo.toml
 *   - Update the local tono-windows entry in Cargo.lock
 *   - Update the version field in src-tauri/tauri.conf.json
 *   - Run tooling/scripts/verify-desktop-version.py and warn when the desktop
 *     versions still disagree (the macOS project is bumped separately)
 *
 * Errors are logged and the process exits with code 1 on failure.
 */

import { execSync, spawnSync } from 'child_process'
import fs from 'fs/promises'
import path from 'path'

import { program } from 'commander'

import {
  setCargoLockVersion,
  setCargoPackageVersion,
} from './cargo-version.mjs'

/**
 * 获取当前 git 短 commit hash
 * @returns {string}
 */
function getGitShortCommit() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    console.warn("[WARN]: Failed to get git short commit, fallback to 'nogit'")
    return 'nogit'
  }
}

/**
 * 获取最新 Tauri 相关提交的短 hash
 * @returns {string}
 */
function getLatestTauriCommit() {
  try {
    const fullHash = execSync(
      'bash ./scripts-workflow/get_latest_tauri_commit.bash',
    )
      .toString()
      .trim()
    const shortHash = execSync(`git rev-parse --short ${fullHash}`)
      .toString()
      .trim()
    console.log(`[INFO]: Latest Tauri-related commit: ${shortHash}`)
    return shortHash
  } catch (error) {
    console.warn(
      '[WARN]: Failed to get latest Tauri commit, fallback to current git short commit',
    )
    console.warn(`[WARN]: Error details: ${error.message}`)
    return getGitShortCommit()
  }
}

/**
 * 生成短时间戳（格式：MMDD）或带 commit（格式：MMDD.cc39b27）
 * 使用 Asia/Shanghai 时区
 * @param {boolean} withCommit 是否带 commit
 * @param {boolean} useTauriCommit 是否使用 Tauri 相关的 commit（仅当 withCommit 为 true 时有效）
 * @returns {string}
 */
function generateShortTimestamp(withCommit = false, useTauriCommit = false) {
  const now = new Date()

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(now)
  const month = parts.find((part) => part.type === 'month').value
  const day = parts.find((part) => part.type === 'day').value

  if (withCommit) {
    const gitShort = useTauriCommit
      ? getLatestTauriCommit()
      : getGitShortCommit()
    return `${month}${day}.${gitShort}`
  }
  return `${month}${day}`
}

/**
 * 验证版本号格式
 * @param {string} version
 * @returns {boolean}
 */
function isValidVersion(version) {
  return /^v?\d+\.\d+\.\d+(-(alpha|beta|rc)(\.\d+)?)?(\+[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*)?$/i.test(
    version,
  )
}

/**
 * 标准化版本号
 * @param {string} version
 * @returns {string}
 */
function normalizeVersion(version) {
  return version.startsWith('v') ? version : `v${version}`
}

/**
 * 提取基础版本号（去掉所有 -tag 和 +build 部分）
 * @param {string} version
 * @returns {string}
 */
function getBaseVersion(version) {
  let base = version.replace(/-(alpha|beta|rc)(\.\d+)?/i, '')
  base = base.replace(/\+[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*/g, '')
  return base
}

/**
 * 更新 package.json 版本号
 * @param {string} newVersion
 */
async function updatePackageVersion(newVersion) {
  const _dirname = process.cwd()
  const packageJsonPath = path.join(_dirname, 'package.json')
  try {
    const data = await fs.readFile(packageJsonPath, 'utf8')
    const packageJson = JSON.parse(data)

    console.log(
      '[INFO]: Current package.json version is: ',
      packageJson.version,
    )
    packageJson.version = newVersion.startsWith('v')
      ? newVersion.slice(1)
      : newVersion
    await fs.writeFile(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2),
      'utf8',
    )
    console.log(
      `[INFO]: package.json version updated to: ${packageJson.version}`,
    )
  } catch (error) {
    console.error('Error updating package.json version:', error)
    throw error
  }
}

/**
 * 更新 Cargo.toml 版本号
 * @param {string} newVersion
 */
async function updateCargoVersion(newVersion) {
  const _dirname = process.cwd()
  const cargoTomlPath = path.join(_dirname, 'src-tauri', 'Cargo.toml')
  try {
    const data = await fs.readFile(cargoTomlPath, 'utf8')
    const versionWithoutV = newVersion.startsWith('v')
      ? newVersion.slice(1)
      : newVersion

    // `cargo metadata --locked` (windows-release.yml) and
    // verify-desktop-version.py both read the lock entry.
    const cargoLockPath = path.join(_dirname, 'Cargo.lock')
    const lock = await fs.readFile(cargoLockPath, 'utf8')
    const bumpedToml = setCargoPackageVersion(data, versionWithoutV)
    const bumpedLock = setCargoLockVersion(
      lock,
      'tono-windows',
      versionWithoutV,
    )

    await fs.writeFile(cargoTomlPath, bumpedToml, 'utf8')
    console.log(`[INFO]: Cargo.toml version updated to: ${versionWithoutV}`)
    await fs.writeFile(cargoLockPath, bumpedLock, 'utf8')
    console.log(`[INFO]: Cargo.lock version updated to: ${versionWithoutV}`)
  } catch (error) {
    console.error('Error updating Cargo.toml version:', error)
    throw error
  }
}

/**
 * Report whether every desktop version now agrees. Not fatal: a tag such as
 * autobuild is a Windows-only version, and the macOS project is bumped by hand.
 */
function reportDesktopVersions() {
  const verifier = path.join(
    process.cwd(),
    '..',
    '..',
    '..',
    'tooling',
    'scripts',
    'verify-desktop-version.py',
  )
  for (const python of ['python3', 'python']) {
    const result = spawnSync(python, [verifier], { encoding: 'utf8' })
    if (result.error) continue
    if (result.status === 0) {
      console.log('[INFO]: Desktop versions agree')
    } else {
      console.warn(
        `[WARN]: Desktop versions still disagree; the release workflows refuse this tree:\n${result.stderr || result.stdout}`,
      )
    }
    return
  }
  console.warn('[WARN]: python not found, verify-desktop-version.py not run')
}

/**
 * 更新 tauri.conf.json 版本号
 * @param {string} newVersion
 */
async function updateTauriConfigVersion(newVersion) {
  const _dirname = process.cwd()
  const tauriConfigPath = path.join(_dirname, 'src-tauri', 'tauri.conf.json')
  try {
    const data = await fs.readFile(tauriConfigPath, 'utf8')
    const tauriConfig = JSON.parse(data)
    const versionWithoutV = newVersion.startsWith('v')
      ? newVersion.slice(1)
      : newVersion

    console.log(
      '[INFO]: Current tauri.conf.json version is: ',
      tauriConfig.version,
    )

    // 使用完整版本信息，包含build metadata
    tauriConfig.version = versionWithoutV

    await fs.writeFile(
      tauriConfigPath,
      JSON.stringify(tauriConfig, null, 2),
      'utf8',
    )
    console.log(
      `[INFO]: tauri.conf.json version updated to: ${versionWithoutV}`,
    )
  } catch (error) {
    console.error('Error updating tauri.conf.json version:', error)
    throw error
  }
}

/**
 * Run the edits; when any of them fails, put every file back as it was. A
 * version bumped in two files out of four is worse than no bump.
 * @param {string[]} files
 * @param {() => Promise<void>} edits
 */
async function allOrNothing(files, edits) {
  const originals = await Promise.all(
    files.map((file) => fs.readFile(file, 'utf8')),
  )
  try {
    await edits()
  } catch (error) {
    // One file that cannot be put back must not stop the others, and must
    // not replace the error that caused the rollback.
    const stuck = []
    for (const [index, file] of files.entries()) {
      try {
        await fs.writeFile(file, originals[index], 'utf8')
      } catch {
        stuck.push(file)
      }
    }
    if (stuck.length > 0) {
      console.error(
        `[ERROR]: could not restore ${stuck.join(', ')}; check the version there by hand`,
      )
    }
    throw error
  }
}

/**
 * 获取当前版本号
 */
async function getCurrentVersion() {
  const _dirname = process.cwd()
  const packageJsonPath = path.join(_dirname, 'package.json')
  try {
    const data = await fs.readFile(packageJsonPath, 'utf8')
    const packageJson = JSON.parse(data)
    return packageJson.version
  } catch (error) {
    console.error('Error getting current version:', error)
    throw error
  }
}

/**
 * 主函数
 */
async function main(versionArg) {
  if (!versionArg) {
    console.error('Error: Version argument is required')
    process.exit(1)
  }

  try {
    let newVersion
    const validTags = [
      'alpha',
      'beta',
      'rc',
      'autobuild',
      'autobuild-latest',
      'deploytest',
    ]

    if (validTags.includes(versionArg.toLowerCase())) {
      const currentVersion = await getCurrentVersion()
      const baseVersion = getBaseVersion(currentVersion)

      if (versionArg.toLowerCase() === 'autobuild') {
        // 格式: 2.3.0+autobuild.1004.cc39b27
        // 使用 Tauri 相关的最新 commit hash
        newVersion = `${baseVersion}+autobuild.${generateShortTimestamp(true, true)}`
      } else if (versionArg.toLowerCase() === 'autobuild-latest') {
        // 格式: 2.3.0+autobuild.1004.a1b2c3d (使用最新 Tauri 提交)
        const latestTauriCommit = getLatestTauriCommit()
        newVersion = `${baseVersion}+autobuild.${generateShortTimestamp()}.${latestTauriCommit}`
      } else if (versionArg.toLowerCase() === 'deploytest') {
        // 格式: 2.3.0+deploytest.1004.cc39b27
        // 使用 Tauri 相关的最新 commit hash
        newVersion = `${baseVersion}+deploytest.${generateShortTimestamp(true, true)}`
      } else {
        newVersion = `${baseVersion}-${versionArg.toLowerCase()}`
      }
    } else {
      if (!isValidVersion(versionArg)) {
        console.error('Error: Invalid version format')
        process.exit(1)
      }
      newVersion = normalizeVersion(versionArg)
    }

    console.log(`[INFO]: Updating versions to: ${newVersion}`)
    const cwd = process.cwd()
    await allOrNothing(
      [
        path.join(cwd, 'package.json'),
        path.join(cwd, 'src-tauri', 'Cargo.toml'),
        path.join(cwd, 'Cargo.lock'),
        path.join(cwd, 'src-tauri', 'tauri.conf.json'),
      ],
      async () => {
        await updatePackageVersion(newVersion)
        await updateCargoVersion(newVersion)
        await updateTauriConfigVersion(newVersion)
      },
    )
    console.log('[SUCCESS]: All version updates completed successfully!')
    reportDesktopVersions()
  } catch (error) {
    console.error('[ERROR]: Failed to update versions:', error)
    process.exit(1)
  }
}

program
  .name('pnpm release-version')
  .description('Update project version numbers')
  .argument('<version>', 'version tag or full version')
  .action(main)
  .parse(process.argv)
