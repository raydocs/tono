#!/usr/bin/env node
// Does any ops alert rule send the *recovery* of an API relay outage?
//
// The relay incident (services/control-plane/src/ops/relay-alerts.ts, backlog
// A6) has kind `api-relay-down`, subject type `fleet`, subject id `<host>:<port>`,
// severity `warn` and impact 0. A rule sends its resolve message only when
// `ruleMatches` (src/ops/alerts.ts) passes for a resolve transition, which
// needs fire_on = open_resolve, and when the incident's last send (the
// opening) is at least cooldown_seconds old (`planDeliveries`). So a rule
// covers recoveries when it is enabled, its match fields admit that incident,
// fire_on = open_resolve, and cooldown_seconds is shorter than the outage.
//
// The shortest outage that opens an incident resolves one check cadence
// (300 s) after it opened, so the default --outage-seconds 300 asks for a rule
// that reports every recovery. docs/ops/api-relay.md "Alerts" has the rule.
//
// Input (read-only, no network) is any of:
//   - the ops API list:  GET /api/v1/ops/alert-rules  -> { items: [AlertRuleDto] }
//   - a plain JSON array of AlertRuleDto (camelCase)
//   - `wrangler d1 execute ... --json --command "SELECT ... FROM ops_alert_rules"`
//     output: [{ results: [snake_case rows] }]
// Rule targets are never printed.
//
// Usage: node tooling/scripts/check-relay-alert-rule.mjs <rules.json> [--outage-seconds N]
// Exit: 0 a covering rule exists, 1 none does, 2 bad input.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RELAY_INCIDENT = Object.freeze({
  kind: 'api-relay-down',
  subjectType: 'fleet',
  severity: 'warn',
  impactCount: 0,
})
export const DEFAULT_OUTAGE_SECONDS = 300
const SEVERITY_RANK = { notice: 0, warn: 1, severe: 2 }

const SNAKE_TO_CAMEL = {
  match_kind: 'matchKind',
  match_subject_type: 'matchSubjectType',
  match_subject_id: 'matchSubjectId',
  min_severity: 'minSeverity',
  min_impact: 'minImpact',
  fire_on: 'fireOn',
  delay_seconds: 'delaySeconds',
  cooldown_seconds: 'cooldownSeconds',
}

function normalizeRule(raw) {
  if (raw === null || typeof raw !== 'object') throw new Error('a rule is not an object')
  const rule = {}
  for (const [key, value] of Object.entries(raw)) rule[SNAKE_TO_CAMEL[key] ?? key] = value
  // D1 rows carry 0/1; the API DTO carries booleans.
  rule.enabled = rule.enabled === true || rule.enabled === 1
  for (const key of ['minImpact', 'delaySeconds', 'cooldownSeconds']) {
    if (rule[key] !== undefined && rule[key] !== null) rule[key] = Number(rule[key])
  }
  return rule
}

/** Accepts the three input shapes above; returns camelCase rules. */
export function rulesFromJson(data) {
  let rows
  if (Array.isArray(data) && data.length > 0 && data.every((d) => d && Array.isArray(d.results))) {
    rows = data.flatMap((d) => d.results)
  } else if (Array.isArray(data)) {
    rows = data
  } else if (data && Array.isArray(data.items)) {
    rows = data.items
  } else {
    throw new Error('expected { items: [...] }, an array of rules, or wrangler d1 --json output')
  }
  return rows.map(normalizeRule)
}

/**
 * Why `rule` does not send the relay recovery, or null when it does.
 * Mirrors ruleMatches + the cooldown check in services/control-plane/src/ops/alerts.ts.
 */
export function whyNotRecovery(rule, outageSeconds = DEFAULT_OUTAGE_SECONDS) {
  if (!rule.enabled) return 'disabled'
  if (rule.matchKind != null && rule.matchKind !== RELAY_INCIDENT.kind) {
    return `matches kind ${rule.matchKind}, not ${RELAY_INCIDENT.kind}`
  }
  if (rule.matchSubjectType != null && rule.matchSubjectType !== RELAY_INCIDENT.subjectType) {
    return `matches subject type ${rule.matchSubjectType}, not ${RELAY_INCIDENT.subjectType}`
  }
  const minRank = SEVERITY_RANK[rule.minSeverity ?? 'warn']
  if (minRank === undefined) return `unknown min severity ${rule.minSeverity}`
  if (SEVERITY_RANK[RELAY_INCIDENT.severity] < minRank) {
    return `min severity ${rule.minSeverity} is above ${RELAY_INCIDENT.severity}`
  }
  if ((rule.minImpact ?? 0) > RELAY_INCIDENT.impactCount) {
    return `min impact ${rule.minImpact} is above ${RELAY_INCIDENT.impactCount}`
  }
  if (rule.fireOn !== 'open_resolve') return `fire_on is ${rule.fireOn ?? 'open'}, not open_resolve`
  const cooldown = rule.cooldownSeconds ?? 3600
  if (!(cooldown < outageSeconds)) {
    return `cooldown ${cooldown}s is not shorter than a ${outageSeconds}s outage; the recovery would be suppressed`
  }
  return null
}

function label(rule) {
  return `${rule.id ?? '?'} (${rule.name ?? 'unnamed'})`
}

export function report(rules, outageSeconds = DEFAULT_OUTAGE_SECONDS) {
  const lines = []
  const covering = []
  for (const rule of rules) {
    const why = whyNotRecovery(rule, outageSeconds)
    if (why) {
      lines.push(`skip ${label(rule)}: ${why}`)
      continue
    }
    covering.push(rule)
    const scope = rule.matchSubjectId != null ? ` (only relay ${rule.matchSubjectId})` : ''
    lines.push(`PASS ${label(rule)}: sends ${RELAY_INCIDENT.kind} recoveries${scope}, cooldown ${rule.cooldownSeconds}s`)
  }
  const ok = covering.some((rule) => rule.matchSubjectId == null)
  if (ok) {
    lines.push(`OK: ${RELAY_INCIDENT.kind} recoveries are sent for outages of ${outageSeconds}s or longer`)
  } else if (covering.length) {
    lines.push(`MISSING: covering rules are limited to single relays; add one without 只看这一个对象`)
  } else {
    lines.push(`MISSING: no enabled rule sends ${RELAY_INCIDENT.kind} recoveries (fire_on=open_resolve, cooldown < ${outageSeconds}s); see docs/ops/api-relay.md "Alerts"`)
  }
  return { ok, lines }
}

function main(argv) {
  const file = argv.find((arg, i) => !arg.startsWith('--') && argv[i - 1] !== '--outage-seconds')
  const at = argv.indexOf('--outage-seconds')
  const outage = at === -1 ? DEFAULT_OUTAGE_SECONDS : Number(argv[at + 1])
  if (!file || !Number.isInteger(outage) || outage <= 0) {
    console.error('usage: check-relay-alert-rule.mjs <rules.json> [--outage-seconds N]')
    return 2
  }
  let rules
  try {
    rules = rulesFromJson(JSON.parse(readFileSync(file, 'utf8')))
  } catch (error) {
    console.error(`check-relay-alert-rule: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }
  const { ok, lines } = report(rules, outage)
  for (const line of lines) console.log(line)
  return ok ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)))
}
