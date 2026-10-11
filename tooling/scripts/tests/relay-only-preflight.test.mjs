import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// Handwritten hosted-log fixtures, not expectations imported from the checker.
const windowsLog = `test tono::transport::tests::relay_only_without_tunnel::without_a_tunnel_the_pinned_and_system_paths_are_never_dialed ... ok
test tono::transport::tests::relay_only_without_tunnel::without_a_tunnel_two_dead_relays_leave_the_third_inside_the_budget_and_it_goes_first_next ... ok
test tono::transport::tests::relay_only_without_tunnel::without_a_tunnel_a_failure_names_every_relay_and_dials_no_direct_path ... ok
test tono::transport::tests::relay_only_without_tunnel::a_relay_walk_dropped_mid_attempt_stops_and_keeps_the_remembered_relay ... ok
test tono::transport::tests::relay_only_without_tunnel::with_a_tunnel_the_direct_path_still_goes_first ... ok
test tono::transport::tests::relay_only_without_tunnel::a_tunnel_lost_mid_walk_skips_the_remaining_direct_steps_for_the_relays ... ok
test tono::transport::tests::relay_only_without_tunnel::a_step_waiting_on_the_service_probe_honours_a_latch_set_meanwhile ... ok
test tono::transport::tests::relay_only_without_tunnel::a_tunnel_lost_before_doh_sends_no_doh_query_and_no_direct_request ... ok
test tono::transport::tests::relay_only_without_tunnel::a_tunnel_lost_after_the_doh_check_sends_no_doh_query ... ok
test tono::transport::tests::relay_only_without_tunnel::a_tunnel_lost_mid_alternate_port_walk_dials_no_further_port_and_uses_the_relays ... ok
test tono::transport::tests::relay_only_without_tunnel::a_tunnel_lost_during_the_loopback_request_ends_with_the_relay_unreachable_error ... ok
test tono::transport::tests::relay_only_without_tunnel::a_tunnel_lost_during_the_relays_ends_with_the_relay_unreachable_error ... ok
test tono::commands::restore::offline_admission_tests::unreachable_restore_is_ready_offline_only_on_a_grant_matching_memory ... ok
test tono::commands::restore::offline_admission_tests::delayed_startup_restore_cannot_supersede_interactive_sign_in ... ok
test tono::connection::transaction::tests::cancellation_during_a_wait_drops_the_cancellation_safe_stage ... ok
test tono::credentials::tests::delayed_vault_mutations_cannot_resurrect_or_erase_a_replacement_token ... ok
test result: ok. 709 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 56.58s
`
const macosLog = `Test Case '-[TonoTests.AccountSessionRequestTests testArmedWithoutATunnelTheRequestGoesToTheRelayOnly]' passed (0.004 seconds).
Test Case '-[TonoTests.AccountSessionRequestTests testArmedWithoutATunnelBothRelaysDownFailsWithoutAnyOtherPath]' passed (1.020 seconds).
Test Case '-[TonoTests.AccountSessionRequestTests testTheThirdRelayIsDialedAfterTheFirstTwoFail]' passed (3.026 seconds).
Test Case '-[TonoTests.AccountSessionRequestTests testASilentFirstRelayLeavesTheSecondRelayTheRestOfTheConnectBudget]' passed (2.039 seconds).
Test Case '-[TonoTests.AccountSessionRequestTests testATunnelLostDuringTheWalkSkipsTheDirectStepsStillAhead]' passed (0.007 seconds).
Test Case '-[TonoTests.AccountSessionRequestTests testATunnelLostBetweenStepsSkipsTheNextDirectStep]' passed (0.008 seconds).
Test Case '-[TonoTests.AccountSessionRequestTests testATunnelLostAfterAFailedRememberedRelayRetriesOnTheRelaysAlone]' passed (1.054 seconds).
Test Case '-[TonoTests.AccountSessionRequestTests testAnUnreachableSignInWhileProtectionHoldsNamesTheRelaysAndKeepsProtection]' passed (1.125 seconds).
Test Case '-[TonoTests.AccountSessionRequestTests testUnreachableRestoreIsReadyOfflineOnlyOnAGrantMatchingMemory]' passed (1.105 seconds).
Test Case '-[TonoTests.AccountSessionRequestTests testUnreachableRestoreWithoutAGrantKeepsConnectRefused]' passed (1.086 seconds).
Test Case '-[TonoTests.AccountSessionRequestTests testACancelledReadStopsWaitingForItsTokenRenewal]' passed (0.264 seconds).
Test Case '-[TonoTests.AccountSessionRequestTests testCancelledAuthenticationDoesNotAdoptLateCredentials]' passed (0.113 seconds).
Test Case '-[TonoTests.AccountSessionRequestTests testLateCatalogDoesNotReachConsumerForAnotherAccount]' passed (0.101 seconds).
Test Case '-[TonoTests.AccountSessionRequestTests testLateRefreshCannotOverwriteAnotherAccount]' passed (0.018 seconds).
Test Case '-[TonoTests.AccountSessionRequestTests testCancelledFallbackCannotReactivateProtection]' passed (0.017 seconds).
Test Case '-[TonoTests.AccountSessionRequestTests testAccountReleaseCannotDisarmAfterDisconnectOwnerRetainsProtection]' passed (0.005 seconds).
Test Case '-[TonoTests.ConnectionCoordinatorTests testDisconnectDrainsCancelledMutationBeforeAnyReleaseStep]' passed (0.001 seconds).
Executed 707 tests, with 1 test skipped and 0 failures (0 unexpected) in 134.596 (134.996) seconds
`

test('the public CLI refuses unearned green evidence and stale dependencies', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'tono-relay-preflight-'))
  try {
    const cwd = path.join(root, 'repo')
    const bin = path.join(root, 'bin')
    mkdirSync(path.join(cwd, 'apps/windows'), { recursive: true })
    mkdirSync(path.join(cwd, 'docs'), { recursive: true })
    mkdirSync(bin)
    const env = {
      ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      PREFLIGHT_FIXTURE: path.join(root, 'fixture.json'),
      GIT_AUTHOR_NAME: 'Preflight test', GIT_AUTHOR_EMAIL: 'preflight@example.test',
      GIT_COMMITTER_NAME: 'Preflight test', GIT_COMMITTER_EMAIL: 'preflight@example.test',
    }
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      return result.stdout.trim()
    }
    git('init', '-q')
    const dependency = path.join(cwd, 'apps/windows/Cargo.lock')
    writeFileSync(dependency, 'locked dependency A\n')
    git('add', '.')
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'native source')
    const testedSha = git('rev-parse', 'HEAD')
    writeFileSync(path.join(cwd, 'docs/checkpoint.md'), 'docs-only checkpoint\n')
    git('add', '.')
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'docs-only checkpoint')
    const checkpoint = git('rev-parse', 'HEAD')
    const checkout = `[command]git log -1 --format=%H\n${testedSha}\n`
    const run = (workflowName, name, log) => ({
      metadata: { headSha: testedSha, headBranch: 'main', event: 'push', workflowName,
        status: 'completed', conclusion: 'success',
        jobs: [{ name, databaseId: 123, status: 'completed', conclusion: 'success' }] },
      log: checkout + log,
    })
    const fixture = {
      1: run('Windows CI', 'app-rust', windowsLog),
      2: run('macOS CI', 'build', macosLog),
    }
    writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
import { readFileSync } from 'node:fs'
const args = process.argv.slice(2)
const run = JSON.parse(readFileSync(process.env.PREFLIGHT_FIXTURE, 'utf8'))[args[2]]
process.stdout.write(args.includes('--log') ? run.log : JSON.stringify(run.metadata))
`, { mode: 0o755 })
    const script = fileURLToPath(new URL('./relay-only-preflight.mjs', import.meta.url))
    const check = () => {
      writeFileSync(env.PREFLIGHT_FIXTURE, JSON.stringify(fixture))
      return spawnSync(process.execPath, [script, checkpoint, '1', '2'], {
        // The dependency being checked is outside the caller's subtree.
        cwd: path.join(cwd, 'docs'), env, encoding: 'utf8', timeout: 15000,
      })
    }
    const accepted = check()
    assert.equal(accepted.status, 0, accepted.stderr)
    const receipt = JSON.parse(accepted.stdout)
    assert.equal(receipt.kind, 'component-evidence-preflight')
    assert.equal(receipt.checkpoint, checkpoint)
    assert.equal(receipt.evidence[0].actualCheckoutSha, testedSha)
    assert.equal(receipt.evidence[0].namedPassed.length, 16)
    assert.equal(receipt.evidence[1].namedPassed.length, 17)
    assert.match(receipt.evidence[0].unverifiedFaultExecution.join('\n'), /captured success stderr cannot prove fault execution/)
    assert.match(receipt.limits.join('\n'), /No installed-device PF\/WFP/)

    // The known early-return fault still prints ok. Metadata and suite totals stay green.
    fixture[1].log += 'skipped: a tunnel is completing the blackhole connect; run without a VPN\n'
    const skipped = check()
    assert.equal(skipped.status, 1)
    assert.equal(skipped.stdout, '')
    assert.match(skipped.stderr, /blackhole fault was skipped despite an ok result/)
    fixture[1].log = checkout + windowsLog

    fixture[1].log = fixture[1].log.replace('a_relay_walk_dropped_mid_attempt', 'another_walk')
    assert.match(check().stderr, /a_relay_walk_dropped_mid_attempt.*missing/)
    fixture[1].log = checkout + windowsLog
    fixture[1].log = fixture[1].log.replace(testedSha, 'f'.repeat(40))
    assert.match(check().stderr, /mismatched actual checkout/)
    fixture[1].log = checkout + windowsLog
    fixture[1].metadata.event = 'pull_request'
    assert.match(check().stderr, /not a PR merge ref/)
    fixture[1].metadata.event = 'push'

    writeFileSync(dependency, 'locked dependency B\n')
    assert.match(check().stderr, /dirty source\/configuration\/dependencies/)
    git('add', '.')
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'changed dependency')
    const stale = check()
    assert.equal(stale.status, 1)
    assert.equal(stale.stdout, '')
    assert.match(stale.stderr, /stale source: apps\/windows\/Cargo.lock/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
