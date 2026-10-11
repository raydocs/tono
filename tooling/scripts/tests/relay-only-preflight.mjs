// Read-only reuse of named native faults, not a transport simulator or release approval.
import { spawnSync } from 'node:child_process'

const repository = 'raydocs/tono'
let cwd = process.cwd()
// Conservatively compare every tracked input, including dependencies, configuration and CI.
// Documentation, this tooling and the operator-only aggregate are exempt. The hosted
// native jobs do not call that aggregate; product code/tests and workflows are not exempt.
const sourceScope = [
  '.', ':!docs',
  ':!tooling/scripts/tests/relay-only-preflight.mjs',
  ':!tooling/scripts/tests/relay-only-preflight.test.mjs',
  ':!tooling/scripts/test-macos-all.sh',
]
const relay = 'tono::transport::tests::relay_only_without_tunnel::'
const windowsTests = [
  'without_a_tunnel_the_pinned_and_system_paths_are_never_dialed',
  'without_a_tunnel_two_dead_relays_leave_the_third_inside_the_budget_and_it_goes_first_next',
  'without_a_tunnel_a_failure_names_every_relay_and_dials_no_direct_path',
  'a_relay_walk_dropped_mid_attempt_stops_and_keeps_the_remembered_relay',
  'with_a_tunnel_the_direct_path_still_goes_first',
  'a_tunnel_lost_mid_walk_skips_the_remaining_direct_steps_for_the_relays',
  'a_step_waiting_on_the_service_probe_honours_a_latch_set_meanwhile',
  'a_tunnel_lost_before_doh_sends_no_doh_query_and_no_direct_request',
  'a_tunnel_lost_after_the_doh_check_sends_no_doh_query',
  'a_tunnel_lost_mid_alternate_port_walk_dials_no_further_port_and_uses_the_relays',
  'a_tunnel_lost_during_the_loopback_request_ends_with_the_relay_unreachable_error',
  'a_tunnel_lost_during_the_relays_ends_with_the_relay_unreachable_error',
].map(name => relay + name).concat([
  'tono::commands::restore::offline_admission_tests::unreachable_restore_is_ready_offline_only_on_a_grant_matching_memory',
  'tono::commands::restore::offline_admission_tests::delayed_startup_restore_cannot_supersede_interactive_sign_in',
  'tono::connection::transaction::tests::cancellation_during_a_wait_drops_the_cancellation_safe_stage',
  'tono::credentials::tests::delayed_vault_mutations_cannot_resurrect_or_erase_a_replacement_token',
])
const macosTests = [
  'testArmedWithoutATunnelTheRequestGoesToTheRelayOnly',
  'testArmedWithoutATunnelBothRelaysDownFailsWithoutAnyOtherPath',
  'testTheThirdRelayIsDialedAfterTheFirstTwoFail',
  'testASilentFirstRelayLeavesTheSecondRelayTheRestOfTheConnectBudget',
  'testATunnelLostDuringTheWalkSkipsTheDirectStepsStillAhead',
  'testATunnelLostBetweenStepsSkipsTheNextDirectStep',
  'testATunnelLostAfterAFailedRememberedRelayRetriesOnTheRelaysAlone',
  'testAnUnreachableSignInWhileProtectionHoldsNamesTheRelaysAndKeepsProtection',
  'testUnreachableRestoreIsReadyOfflineOnlyOnAGrantMatchingMemory',
  'testUnreachableRestoreWithoutAGrantKeepsConnectRefused',
  'testACancelledReadStopsWaitingForItsTokenRenewal',
  'testCancelledAuthenticationDoesNotAdoptLateCredentials',
  'testLateCatalogDoesNotReachConsumerForAnotherAccount',
  'testLateRefreshCannotOverwriteAnotherAccount',
  'testCancelledFallbackCannotReactivateProtection',
  'testAccountReleaseCannotDisarmAfterDisconnectOwnerRetainsProtection',
].map(name => `AccountSessionRequestTests ${name}`).concat([
  'ConnectionCoordinatorTests testDisconnectDrainsCancelledMutationBeforeAnyReleaseStep',
])

function command(executable, args) {
  const result = spawnSync(executable, args, {
    cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  })
  // Do not echo raw gh output: logs and errors can contain account/credential data.
  if (result.error || result.status !== 0) {
    throw new Error(`${executable} ${args[0]} failed (${result.error?.code ?? result.status}); evidence unavailable`)
  }
  return result.stdout
}

function unchanged(from, to) {
  const changed = command('git', ['diff', '--name-only', from, to, '--', ...sourceScope]).trim()
  if (changed) throw new Error(`stale source: ${changed.split('\n').join(', ')}`)
}

function literal(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collect(runId, workflow, jobName, names, checkpoint, workingHead) {
  const run = JSON.parse(command('gh', [
    'run', 'view', runId, '--repo', repository, '--json',
    'headSha,headBranch,status,conclusion,event,workflowName,jobs',
  ]))
  if (run.status !== 'completed' || run.conclusion !== 'success'
      || run.event !== 'push' || run.headBranch !== 'main' || run.workflowName !== workflow
      || !/^[a-f0-9]{40}$/.test(run.headSha)) {
    throw new Error(`${workflow}: expected completed green push on main, not a PR merge ref`)
  }
  unchanged(run.headSha, checkpoint)
  unchanged(checkpoint, workingHead)
  const job = run.jobs.find(job => job.name === jobName)
  if (!job || job.status !== 'completed' || job.conclusion !== 'success') {
    throw new Error(`${workflow}: ${jobName} absent, incomplete or unsuccessful`)
  }
  const log = command('gh', [
    'run', 'view', runId, '--repo', repository, '--job', String(job.databaseId), '--log',
  ]).replace(/\x1b\[[0-9;]*m/g, '')
  const lines = log.split('\n').map(line => line.replace(/^[^\t]*\t[^\t]*\t\S+ /, ''))
  const checkouts = lines.flatMap((line, index) =>
    line.includes(' log -1 --format=%H') ? [lines[index + 1]?.trim()] : [])
  if (checkouts.length !== 1 || checkouts[0] !== run.headSha) {
    throw new Error(`${workflow}: missing/mismatched actual checkout SHA in job log`)
  }
  // Some Rust tests return early with an eprintln! and still print `... ok`.
  if (/skipped:.*blackhole/i.test(log)) {
    throw new Error(`${workflow}: blackhole fault was skipped despite an ok result`)
  }
  const isWindows = workflow === 'Windows CI'
  const summary = isWindows
    ? lines.find(line => /^test result: ok\. [1-9]\d* passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;/.test(line))
    : lines.filter(line => /Executed [1-9]\d* tests, with (?:\d+ test skipped and )?0 failures/.test(line)).at(-1)
  if (!summary) throw new Error(`${workflow}: complete successful suite summary unavailable`)
  for (const name of names) {
    const outcome = new RegExp(isWindows
      ? `^test ${literal(name)} \\.\\.\\. (.+)$`
      : `^Test Case '-\\[TonoTests\\.${literal(name)}\\]' (passed|failed|skipped) \\(`)
    const results = lines.map(line => line.match(outcome)).filter(Boolean)
    if (results.length !== 1 || results[0][1] !== (isWindows ? 'ok' : 'passed')) {
      throw new Error(`${workflow}: ${name} missing, duplicated, failed or skipped`)
    }
  }
  return {
    workflow, runId, jobId: job.databaseId,
    url: `https://github.com/${repository}/actions/runs/${runId}/job/${job.databaseId}`,
    testedSha: run.headSha, actualCheckoutSha: checkouts[0],
    suiteSummary: summary.trim(), namedPassed: names,
    // An ok under Rust's default capture can hide the blackhole guard's early return.
    // Do not infer that this fault ran from unrelated later --nocapture commands.
    unverifiedFaultExecution: isWindows ? [
      'Two-blackhole budget test has an early-return guard; captured success stderr cannot prove fault execution. Recheck this exact test with --exact --nocapture on the tested source.',
    ] : [],
  }
}

try {
  const [checkpoint, windowsRun, macosRun, ...extra] = process.argv.slice(2)
  if (extra.length || !/^[a-f0-9]{40}$/.test(checkpoint ?? '')
      || !/^[1-9]\d*$/.test(windowsRun ?? '') || !/^[1-9]\d*$/.test(macosRun ?? '')) {
    throw new Error('usage: node tooling/scripts/tests/relay-only-preflight.mjs <40-char-checkpoint-SHA> <Windows-main-run-ID> <macOS-main-run-ID>')
  }
  cwd = command('git', ['rev-parse', '--show-toplevel']).trim()
  command('git', ['rev-parse', '--verify', `${checkpoint}^{commit}`])
  const workingHead = command('git', ['rev-parse', 'HEAD']).trim()
  const dirty = command('git', ['status', '--porcelain', '--untracked-files=all', '--', ...sourceScope]).trim()
  if (dirty) throw new Error('dirty source/configuration/dependencies; cannot reuse hosted evidence')
  const evidence = [
    collect(windowsRun, 'Windows CI', 'app-rust', windowsTests, checkpoint, workingHead),
    collect(macosRun, 'macOS CI', 'build', macosTests, checkpoint, workingHead),
  ]
  process.stdout.write(JSON.stringify({
    kind: 'component-evidence-preflight', checkpoint, workingHead,
    sourceComparison: 'all tracked inputs except docs/, the two preflight scripts and operator-only test-macos-all.sh',
    evidence,
    limits: [
      'Reused hosted native component faults; no native test executed on this host.',
      'Named outcomes do not establish semantic requirement coverage or full integration.',
      'No installed-device PF/WFP, mainland home-broadband, package-hash or final-freeze approval.',
    ],
  }, null, 2) + '\n')
} catch (error) {
  process.stderr.write(`preflight not reusable: ${error.message}\n`)
  process.exitCode = 1
}
