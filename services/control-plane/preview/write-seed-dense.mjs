// Additive dense seed on top of preview/seed.mjs. 45 CJK-named nodes, 60
// customers, 400 connection events, 12 incidents, plus one of each supporting
// row the GET {id} routes need. Synthetic only: example.test and TEST-NET-3.
import { writeFile } from 'node:fs/promises';
import { previewSeedSql } from './seed.mjs';

const NODE_STEMS = [
  ['Singapore', 'Harbour', '新加坡海港', 'CMIN2'],
  ['Tokyo', 'Shibuya', '东京涩谷', 'CN2GIA'],
  ['Seoul', 'Han', '首尔汉江', 'CMIN2'],
  ['Osaka', 'Umeda', '大阪梅田', 'CN2'],
  ['Hong Kong', 'Victoria', '香港维多利亚', 'CN2GIA'],
  ['Taipei', 'Daan', '台北大安', 'CN2'],
  ['Los Angeles', 'Echo', '洛杉矶回声', 'CN2GIA'],
  ['San Jose', 'Mission', '圣何塞使命', 'CMIN2'],
  ['Seattle', 'Rainier', '西雅图雷尼尔', 'CN2'],
  ['Dallas', 'Trinity', '达拉斯三一', '9929'],
  ['Chicago', 'Loop', '芝加哥环线', 'CN2GIA'],
  ['Ashburn', 'Potomac', '阿什本波托马克', 'CMIN2'],
  ['Miami', 'Biscayne', '迈阿密比斯坎', 'CN2'],
  ['London', 'Thames', '伦敦泰晤士', 'CN2GIA'],
  ['Frankfurt', 'Main', '法兰克福美因', 'CMIN2'],
  ['Amsterdam', 'Amstel', '阿姆斯特丹阿姆斯特尔', 'CN2'],
  ['Paris', 'Seine', '巴黎塞纳', '9929'],
  ['Zurich', 'Limmat', '苏黎世利马特', 'CN2GIA'],
  ['Stockholm', 'Malaren', '斯德哥尔摩梅拉伦', 'CMIN2'],
  ['Helsinki', 'Baltic', '赫尔辛基波罗的海', 'CN2'],
  ['Warsaw', 'Vistula', '华沙维斯瓦', 'CN2GIA'],
  ['Madrid', 'Manzanares', '马德里曼萨纳雷斯', 'CMIN2'],
  ['Milan', 'Naviglio', '米兰纳维利', 'CN2'],
  ['Vienna', 'Danube', '维也纳多瑙', '9929'],
  ['Istanbul', 'Bosphorus', '伊斯坦布尔博斯普鲁斯', 'CN2GIA'],
  ['Dubai', 'Creek', '迪拜河', 'CMIN2'],
  ['Mumbai', 'Harbour', '孟买海港', 'CN2'],
  ['Delhi', 'Yamuna', '德里亚穆纳', 'CN2GIA'],
  ['Bangkok', 'Chao Phraya', '曼谷湄南', 'CMIN2'],
  ['Jakarta', 'Ciliwung', '雅加达芝利翁', 'CN2'],
  ['Manila', 'Pasig', '马尼拉帕西格', '9929'],
  ['Kuala Lumpur', 'Klang', '吉隆坡巴生', 'CN2GIA'],
  ['Sydney', 'Harbour', '悉尼海港', 'CMIN2'],
  ['Melbourne', 'Yarra', '墨尔本亚拉', 'CN2'],
  ['Auckland', 'Waitemata', '奥克兰怀提马塔', 'CN2GIA'],
  ['Toronto', 'Ontario', '多伦多安大略', 'CMIN2'],
  ['Vancouver', 'Burrard', '温哥华布勒', 'CN2'],
  ['Montreal', 'Saint Laurent', '蒙特利尔圣劳伦斯', '9929'],
  ['Sao Paulo', 'Pinheiros', '圣保罗皮涅伊罗斯', 'CN2GIA'],
  ['Mexico City', 'Chapultepec', '墨西哥城查普尔特佩克', 'CMIN2'],
  ['Santiago', 'Mapocho', '圣地亚哥马波乔', 'CN2'],
  ['Johannesburg', 'Highveld', '约翰内斯堡高地', 'CN2GIA'],
  ['Cairo', 'Nile', '开罗尼罗', 'CMIN2'],
  ['Tel Aviv', 'Yarkon', '特拉维夫雅孔', 'CN2'],
  ['Riyadh', 'Wadi', '利雅得谷地', '9929'],
];

function q(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function nodeName(stem) {
  return `${stem[0]} · ${stem[1]}（${stem[2]} · 大陆直连 · ${stem[3]}）`;
}

export function extrasSql() {
  return `
INSERT INTO provider_accounts(
  id, provider, label, cloud_kind, login_email_masked, billing_url, status, created_at, updated_at
) VALUES (
  'pa-preview-main', 'bandwagon', 'Preview VPS', 'vps', 'b***@example.test',
  'https://billing.example.test/preview', 'active', unixepoch() - 864000, unixepoch() - 30
) ON CONFLICT(id) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at;

INSERT INTO client_releases(
  id, platform, channel, version, build, notes, published_at, created_at, updated_at
) VALUES (
  'rel-preview-macos', 'macos', 'stable', '0.0.72', '72', 'Synthetic preview build',
  unixepoch() - 86400, unixepoch() - 86400, unixepoch() - 30
) ON CONFLICT(id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at;

INSERT INTO direct_candidates(etld1, first_seen, last_seen, users, bytes_30d, status, country_hint)
VALUES ('bilibili.com', unixepoch() - 86400, unixepoch() - 60, 3, 4096, 'new', 'CN')
ON CONFLICT(etld1) DO UPDATE SET last_seen = excluded.last_seen, users = excluded.users;

INSERT INTO ops_incidents(
  id, dedupe_key, kind, subject_type, subject_id, severity, status, title,
  rules_version, opened_at, last_seen_at, impact_count, updated_at
) VALUES (
  'inc-preview-seoul', 'node:Preview Seoul:blocked', 'node_blocked', 'node', 'Preview Seoul',
  'warn', 'open', 'Preview Seoul 被墙', 1, unixepoch() - 3600, unixepoch() - 60, 2, unixepoch() - 60
) ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at;

INSERT INTO ops_incident_events(id, incident_id, at, type, actor, detail)
VALUES ('incev-preview-open', 'inc-preview-seoul', unixepoch() - 3600, 'opened', NULL, 'Synthetic open')
ON CONFLICT(id) DO UPDATE SET detail = excluded.detail;

INSERT INTO ops_alert_rules(
  id, name, enabled, min_severity, min_impact, fire_on, delay_seconds, cooldown_seconds,
  channel, target, template, created_at, updated_at
) VALUES (
  'alr-preview-down', 'node down', 1, 'warn', 1, 'open', 90, 3600,
  'webhook', 'https://hooks.example.test/preview', 'generic', unixepoch() - 86400, unixepoch() - 30
) ON CONFLICT(id) DO UPDATE SET target = excluded.target, updated_at = excluded.updated_at;

INSERT INTO ops_alert_deliveries(
  id, rule_id, incident_id, dedupe_key, transition, status, attempts, created_at, sent_at
) VALUES (
  'ald-preview-1', 'alr-preview-down', 'inc-preview-seoul', 'alr-preview-down:inc-preview-seoul:open',
  'open', 'sent', 1, unixepoch() - 3000, unixepoch() - 2990
) ON CONFLICT(id) DO UPDATE SET status = excluded.status;

INSERT INTO ops_node_jobs(
  id, node_name, executor, type, params_json, status, attempts, max_attempts,
  idempotency_key, requested_by, created_at, not_before, expires_at, updated_at
) VALUES (
  'job-preview-quality', 'Preview Tokyo', 'hub', 'collect_quality', '{}', 'queued', 0, 3,
  'preview-collect-quality-tokyo', 'operator@example.com',
  unixepoch() - 120, unixepoch() - 120, unixepoch() + 780, unixepoch() - 120
) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at;

INSERT INTO ops_audit(id, at, actor_email, action, target_type, target_id, summary, actor_type)
VALUES (
  'aud-preview-job', unixepoch() - 120, 'operator@example.com', 'node-job.create',
  'node_job', 'job-preview-quality', 'queued collect_quality', 'access_admin'
) ON CONFLICT(id) DO UPDATE SET summary = excluded.summary;

INSERT INTO node_error_daily(node, day_at, category, count, sample)
VALUES ('Preview Seoul', CAST(unixepoch() / 86400 AS INTEGER) * 86400, 'dial_timeout', 4, 'timeout')
ON CONFLICT(node, day_at, category) DO UPDATE SET count = excluded.count;

INSERT INTO ops_node_status_history(id, node_name, at, from_verdict, to_verdict, reason, rules_version)
VALUES ('hist-preview-seoul', 'Preview Seoul', unixepoch() - 3600, 'ok', 'blocked', '大陆三网探测失败', 1)
ON CONFLICT(id) DO UPDATE SET reason = excluded.reason;

INSERT INTO home_line_usage_daily(home_exit_id, day_at, source, bytes_up, bytes_down, users, updated_at)
VALUES (
  'home-preview-alpha', CAST(unixepoch() / 86400 AS INTEGER) * 86400, 'client_route',
  1048576, 8388608, 1, unixepoch() - 60
) ON CONFLICT(home_exit_id, day_at, source) DO UPDATE SET bytes_down = excluded.bytes_down;

INSERT INTO customer_activity_hours(
  user_id, device_id, hour_at, online_minutes, connected_minutes, bytes_up, bytes_down, node, platform, app_version
) VALUES (
  'usr-preview-alpha', 'dev-preview-alpha', CAST(unixepoch() / 3600 AS INTEGER) * 3600,
  50, 40, 1024, 8192, 'Preview Tokyo', 'macos', '0.0.72'
) ON CONFLICT(user_id, device_id, hour_at) DO UPDATE SET connected_minutes = excluded.connected_minutes;

INSERT INTO traffic_destination_daily(
  user_id, device_id, day_at, etld1, route, node, connections, bytes_up, bytes_down, top_process, updated_at
) VALUES (
  'usr-preview-alpha', 'dev-preview-alpha', CAST(unixepoch() / 86400 AS INTEGER) * 86400,
  'youtube.com', 'cloud', 'Preview Tokyo', 12, 2048, 65536, 'Tono', unixepoch() - 60
) ON CONFLICT(user_id, device_id, day_at, etld1, route, node) DO UPDATE SET connections = excluded.connections;

INSERT INTO service_usage_daily(user_id, day_at, family, route, bytes, sessions, last_seen_at)
VALUES (
  'usr-preview-alpha', CAST(unixepoch() / 86400 AS INTEGER) * 86400, 'claude', 'cloud',
  4096, 3, unixepoch() - 60
) ON CONFLICT(user_id, day_at, family, route) DO UPDATE SET bytes = excluded.bytes;

INSERT INTO ops_customer_status(
  user_id, device_id, platform, app_version, os_version, connected, selected_server,
  last_seen_at, edge_as_org, edge_asn, updated_at
) VALUES (
  'usr-preview-alpha', 'dev-preview-alpha', 'macos', '0.0.72', 'macOS 15', 1, 'Preview Tokyo',
  unixepoch() - 30, 'China Mobile', 9808, unixepoch() - 30
) ON CONFLICT(user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at;
`;
}

function denseVolumeSql() {
  const chunks = [];
  const verdicts = ['ok', 'ok', 'ok', 'degraded', 'blocked', 'pressure', 'unknown'];
  for (let i = 0; i < NODE_STEMS.length; i += 1) {
    const name = nodeName(NODE_STEMS[i]);
    const ip = `203.0.113.${(i % 200) + 1}`;
    const verdict = verdicts[i % verdicts.length];
    chunks.push(`
INSERT INTO ops_node_profiles(
  id, catalog_name, public_ip, provider, region, os, status, created_at, updated_at, price, currency, billing_cycle
) VALUES (
  ${q(`profile-dense-${i + 1}`)}, ${q(name)}, ${q(ip)}, 'synthetic', ${q(NODE_STEMS[i][0])},
  'linux', 'active', unixepoch() - 2592000, unixepoch() - ${30 + i}, 5, 'USD', 30
) ON CONFLICT(id) DO UPDATE SET catalog_name = excluded.catalog_name, updated_at = excluded.updated_at;

INSERT INTO ops_node_status(
  node_name, verdict, label, reason, candidate_streak, catalog_listed, rules_version, evaluated_at, changed_at
) VALUES (
  ${q(name)}, ${q(verdict)}, ${q(verdict === 'ok' ? '大陆正常' : '需关注')},
  ${q(verdict === 'ok' ? '大陆正常' : '密集夹具合成状态')}, 0, 1, 1,
  unixepoch() - ${30 + i}, unixepoch() - ${30 + i}
) ON CONFLICT(node_name) DO UPDATE SET verdict = excluded.verdict, evaluated_at = excluded.evaluated_at;
`);
  }

  for (let i = 1; i <= 60; i += 1) {
    const id = `usr-dense-${String(i).padStart(2, '0')}`;
    const email = `dense-${String(i).padStart(2, '0')}@example.test`;
    const device = `dev-dense-${String(i).padStart(2, '0')}`;
    const node = nodeName(NODE_STEMS[(i - 1) % NODE_STEMS.length]);
    chunks.push(`
INSERT INTO users(
  id, email, password_hash, password_salt, status, quota_bytes, usage_bytes,
  created_at, updated_at, name, plan, device_limit, notes, contact, first_entitled_at,
  usage_reported_bytes, usage_baseline_bytes
) VALUES (
  ${q(id)}, ${q(email)}, 'PASSWORD_AUTH_DISABLED', 'PASSWORD_AUTH_DISABLED',
  'active', 214748364800, ${i * 1_048_576}, unixepoch() - ${86400 * 30}, unixepoch() - ${i},
  ${q(`Dense ${i}`)}, 'preview', 2, 'Synthetic dense customer', 'preview-only',
  unixepoch() - ${86400 * 30}, ${i * 1_048_576}, 0
) ON CONFLICT(id) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at;

INSERT INTO devices(
  id, user_id, installation_id, name, status, tailscale_ips, created_at, updated_at, last_seen_at, confirmed_at
) VALUES (
  ${q(device)}, ${q(id)}, ${q(`dense-install-${i}`)}, ${q(`Dense Device ${i}`)},
  'active', '[]', unixepoch() - ${86400 * 30}, unixepoch() - ${i}, unixepoch() - ${i}, unixepoch() - ${86400 * 30}
) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, last_seen_at = excluded.last_seen_at;

INSERT INTO ops_customer_status(
  user_id, device_id, platform, app_version, connected, selected_server, last_seen_at, edge_as_org, edge_asn, updated_at
) VALUES (
  ${q(id)}, ${q(device)}, ${q(i % 2 === 0 ? 'windows' : 'macos')}, '0.0.72', 1,
  ${q(node)}, unixepoch() - ${i}, ${q(i % 3 === 0 ? 'China Telecom' : i % 3 === 1 ? 'China Unicom' : 'China Mobile')},
  ${9808 + (i % 7)}, unixepoch() - ${i}
) ON CONFLICT(user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at;
`);
  }

  const eventRows = [];
  const kinds = ['connectOk', 'connectBegin', 'connectFail', 'nodeSwitch', 'disconnectOk'];
  const orgs = ['China Mobile', 'China Telecom', 'China Unicom'];
  for (let i = 0; i < 400; i += 1) {
    const userN = (i % 60) + 1;
    const node = nodeName(NODE_STEMS[i % NODE_STEMS.length]);
    eventRows.push(`(
  ${q(`ce-dense-${i + 1}`)}, ${(i + 1) * 1000}, unixepoch() - ${i}, 'window',
  ${q(`usr-dense-${String(userN).padStart(2, '0')}`)}, ${q(`dev-dense-${String(userN).padStart(2, '0')}`)},
  ${q(userN % 2 === 0 ? 'windows' : 'macos')}, '0.0.72', ${q(kinds[i % kinds.length])},
  ${q(node)}, ${i % 11 === 0 ? q('handshake_timeout') : 'NULL'},
  ${20 + (i % 80)}, ${q(orgs[i % orgs.length])}, 0
)`);
  }
  chunks.push(`
INSERT INTO connection_events(
  id, at_ms, received_at, source, user_id, device_id, platform, app_version, kind, node, code, tcp_delay_ms, edge_as_org, edge_via_exit
) VALUES
${eventRows.join(',\n')}
ON CONFLICT(id) DO UPDATE SET received_at = excluded.received_at;
`);

  const incidentKinds = [
    ['node_blocked', 'node', 'warn', 'open', '被墙'],
    ['node_down', 'node', 'severe', 'open', '失联'],
    ['node_degraded', 'node', 'notice', 'acked', '劣化'],
    ['user_unreachable', 'user', 'warn', 'open', '连不上'],
  ];
  for (let i = 0; i < 12; i += 1) {
    const spec = incidentKinds[i % incidentKinds.length];
    const subject = spec[1] === 'node'
      ? nodeName(NODE_STEMS[i % NODE_STEMS.length])
      : `usr-dense-${String((i % 60) + 1).padStart(2, '0')}`;
    chunks.push(`
INSERT INTO ops_incidents(
  id, dedupe_key, kind, subject_type, subject_id, severity, status, title,
  rules_version, opened_at, last_seen_at, impact_count, updated_at
) VALUES (
  ${q(`inc-dense-${i + 1}`)}, ${q(`dense:${spec[0]}:${i + 1}`)}, ${q(spec[0])}, ${q(spec[1])},
  ${q(subject)}, ${q(spec[2])}, ${q(spec[3])}, ${q(`${subject} ${spec[4]}`)},
  1, unixepoch() - ${3600 * (i + 1)}, unixepoch() - ${60 * (i + 1)}, ${1 + (i % 5)}, unixepoch() - ${60 * (i + 1)}
) ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at;
`);
  }
  return chunks.join('\n');
}

export function denseSeedSql() {
  return `${previewSeedSql}\n${extrasSql()}\n${denseVolumeSql()}\n`;
}

function usage() {
  process.stderr.write('usage: node preview/write-seed-dense.mjs [--output <file>]\n');
  process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  let output;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === '--output' && value && output === undefined) {
      output = value;
    } else {
      usage();
      return;
    }
  }
  const sql = denseSeedSql();
  if (!output) {
    process.stdout.write(sql);
    return;
  }
  await writeFile(output, sql);
  process.stdout.write('Wrote dense synthetic preview SQL locally; no Cloudflare action was performed.\n');
}

const invoked = process.argv[1] && process.argv[1].endsWith('write-seed-dense.mjs');
if (invoked) {
  main().catch((error) => {
    process.stderr.write(`dense seed render failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
