// Synthetic-only D1 data for the isolated preview. `example.test` and the
// three documentation IPv4 blocks are non-routable examples, never customer
// data. This deliberately does not seed encrypted catalog/policy rows: those
// must be created through the Access-protected preview UI with the fresh
// preview-only catalog key.
export const previewSeedSql = String.raw`
DELETE FROM telemetry_windows
WHERE id IN ('telemetry-preview-alpha', 'telemetry-preview-beta');
DELETE FROM operations_agent_samples
WHERE node_name IN ('Preview Tokyo', 'Preview Seoul');
DELETE FROM operations_agent_rollups
WHERE node_name IN ('Preview Tokyo', 'Preview Seoul');
DELETE FROM operations_quality_samples
WHERE node_name IN ('Preview Tokyo', 'Preview Seoul');
DELETE FROM operations_home_probe_samples
WHERE home_exit_id = 'home-preview-alpha';

INSERT INTO users(
  id, email, password_hash, password_salt, status, quota_bytes, usage_bytes,
  created_at, updated_at, name, plan, expires_at, device_limit, notes, contact,
  first_entitled_at, usage_reported_bytes, usage_baseline_bytes
) VALUES
  ('usr-preview-alpha', 'alpha@example.test', 'PASSWORD_AUTH_DISABLED', 'PASSWORD_AUTH_DISABLED',
   'active', 214748364800, 42949672960, unixepoch() - 2592000, unixepoch() - 30,
   'Preview Alpha', 'preview', unixepoch() + 2592000, 3, 'Synthetic preview customer',
   'preview-only', unixepoch() - 2592000, 42949672960, 0),
  ('usr-preview-beta', 'beta@example.test', 'PASSWORD_AUTH_DISABLED', 'PASSWORD_AUTH_DISABLED',
   'active', 107374182400, 100663296000, unixepoch() - 1728000, unixepoch() - 20,
   'Preview Beta', 'preview', unixepoch() + 1209600, 2, 'Synthetic slow-path customer',
   'preview-only', unixepoch() - 1728000, 100663296000, 0),
  ('usr-preview-gamma', 'gamma@example.test', 'PASSWORD_AUTH_DISABLED', 'PASSWORD_AUTH_DISABLED',
   'disabled', NULL, 0, unixepoch() - 864000, unixepoch() - 10,
   'Preview Gamma', 'preview', unixepoch() - 3600, 2, 'Synthetic retired customer',
   'preview-only', unixepoch() - 864000, 0, 0)
ON CONFLICT(id) DO UPDATE SET
  email = excluded.email,
  status = excluded.status,
  quota_bytes = excluded.quota_bytes,
  usage_bytes = excluded.usage_bytes,
  updated_at = excluded.updated_at,
  name = excluded.name,
  plan = excluded.plan,
  expires_at = excluded.expires_at,
  device_limit = excluded.device_limit,
  notes = excluded.notes,
  contact = excluded.contact,
  first_entitled_at = excluded.first_entitled_at,
  usage_reported_bytes = excluded.usage_reported_bytes,
  usage_baseline_bytes = excluded.usage_baseline_bytes;

INSERT INTO devices(
  id, user_id, installation_id, name, status, pending_expires_at,
  tailscale_node_id, tailscale_ips, created_at, updated_at, last_seen_at, confirmed_at
) VALUES
  ('dev-preview-alpha', 'usr-preview-alpha', 'preview-alpha-installation', 'Preview Mac',
   'active', NULL, NULL, '[]', unixepoch() - 2592000, unixepoch() - 30, unixepoch() - 30, unixepoch() - 2591900),
  ('dev-preview-beta', 'usr-preview-beta', 'preview-beta-installation', 'Preview Windows',
   'active', NULL, NULL, '[]', unixepoch() - 1728000, unixepoch() - 20, unixepoch() - 20, unixepoch() - 1727900)
ON CONFLICT(id) DO UPDATE SET
  user_id = excluded.user_id,
  installation_id = excluded.installation_id,
  name = excluded.name,
  status = excluded.status,
  tailscale_ips = excluded.tailscale_ips,
  updated_at = excluded.updated_at,
  last_seen_at = excluded.last_seen_at,
  confirmed_at = excluded.confirmed_at;

INSERT INTO home_exits(
  id, proxy_name, display_name, egress_ipv4, status, notes, created_at, updated_at,
  last_probed_at, probe_status, kind
) VALUES (
  'home-preview-alpha', 'Preview Home Alpha', 'Preview Home Alpha', '198.51.100.8',
  'active', 'Synthetic documentation address only', unixepoch() - 2592000, unixepoch() - 30,
  unixepoch() - 300, 'alive', 'catalog'
)
ON CONFLICT(id) DO UPDATE SET
  proxy_name = excluded.proxy_name,
  display_name = excluded.display_name,
  egress_ipv4 = excluded.egress_ipv4,
  status = excluded.status,
  notes = excluded.notes,
  updated_at = excluded.updated_at,
  last_probed_at = excluded.last_probed_at,
  probe_status = excluded.probe_status,
  kind = excluded.kind;

INSERT INTO user_home_bindings(user_id, home_exit_id, created_at, updated_at, default_proxy_name)
VALUES ('usr-preview-alpha', 'home-preview-alpha', unixepoch() - 2592000, unixepoch() - 30, 'Preview Tokyo')
ON CONFLICT(user_id) DO UPDATE SET
  home_exit_id = excluded.home_exit_id,
  updated_at = excluded.updated_at,
  default_proxy_name = excluded.default_proxy_name;

INSERT INTO product_accounts(
  id, user_id, product, account_ref, status, opened_at, closed_at, close_reason, notes, created_at, updated_at
) VALUES
  ('product-preview-alpha', 'usr-preview-alpha', 'claude_20x', 'preview-account-alpha', 'assigned',
   unixepoch() - 1209600, NULL, NULL, 'Synthetic preview allocation', unixepoch() - 1209600, unixepoch() - 30),
  ('product-preview-pool', NULL, 'claude_20x', 'preview-account-pool', 'pooled',
   NULL, NULL, NULL, 'Synthetic unassigned inventory', unixepoch() - 864000, unixepoch() - 20),
  ('product-preview-beta', 'usr-preview-beta', 'claude_20x', 'preview-account-beta', 'banned',
   unixepoch() - 1728000, unixepoch() - 3600, 'expired', 'Synthetic replacement scenario', unixepoch() - 1728000, unixepoch() - 10)
ON CONFLICT(id) DO UPDATE SET
  user_id = excluded.user_id,
  product = excluded.product,
  account_ref = excluded.account_ref,
  status = excluded.status,
  opened_at = excluded.opened_at,
  closed_at = excluded.closed_at,
  close_reason = excluded.close_reason,
  notes = excluded.notes,
  updated_at = excluded.updated_at;

INSERT INTO product_account_events(id, account_id, user_id, type, at, detail)
VALUES ('event-preview-alpha', 'product-preview-alpha', 'usr-preview-alpha', 'assigned', unixepoch() - 1209600, 'Synthetic preview assignment')
ON CONFLICT(id) DO UPDATE SET
  account_id = excluded.account_id,
  user_id = excluded.user_id,
  type = excluded.type,
  at = excluded.at,
  detail = excluded.detail;

INSERT INTO operations_servers(id, display_name, region_code, provider, status, created_at, updated_at)
VALUES
  ('server-preview-tokyo', 'Preview Tokyo host', 'preview-jp', 'synthetic', 'active', unixepoch() - 2592000, unixepoch() - 30),
  ('server-preview-seoul', 'Preview Seoul host', 'preview-kr', 'synthetic', 'degraded', unixepoch() - 2592000, unixepoch() - 30)
ON CONFLICT(id) DO UPDATE SET
  display_name = excluded.display_name,
  region_code = excluded.region_code,
  provider = excluded.provider,
  status = excluded.status,
  updated_at = excluded.updated_at;

INSERT INTO operations_logical_nodes(id, server_id, display_name, region_code, status, created_at, updated_at)
VALUES
  ('node-preview-tokyo', 'server-preview-tokyo', 'Preview Tokyo', 'preview-jp', 'active', unixepoch() - 2592000, unixepoch() - 30),
  ('node-preview-seoul', 'server-preview-seoul', 'Preview Seoul', 'preview-kr', 'degraded', unixepoch() - 2592000, unixepoch() - 30)
ON CONFLICT(id) DO UPDATE SET
  server_id = excluded.server_id,
  display_name = excluded.display_name,
  region_code = excluded.region_code,
  status = excluded.status,
  updated_at = excluded.updated_at;

INSERT INTO operations_deployments(
  id, server_id, logical_node_id, environment, release_version, status, deployed_at, created_at
) VALUES
  ('deployment-preview-tokyo', 'server-preview-tokyo', 'node-preview-tokyo', 'preview', 'preview-fixture', 'active', unixepoch() - 86400, unixepoch() - 86400),
  ('deployment-preview-seoul', 'server-preview-seoul', 'node-preview-seoul', 'preview', 'preview-fixture', 'failed', unixepoch() - 1800, unixepoch() - 1800)
ON CONFLICT(id) DO UPDATE SET
  server_id = excluded.server_id,
  logical_node_id = excluded.logical_node_id,
  environment = excluded.environment,
  release_version = excluded.release_version,
  status = excluded.status,
  deployed_at = excluded.deployed_at,
  created_at = excluded.created_at;

INSERT INTO ops_node_profiles(
  id, catalog_name, public_ip, provider, billing_url, traffic_quota_bytes, traffic_used_bytes,
  traffic_cycle_start, traffic_cycle_end, cycle_net_in, cycle_net_out, renews_at, notes, status,
  created_at, updated_at, price, currency, billing_cycle
) VALUES
  ('profile-preview-tokyo', 'Preview Tokyo', '203.0.113.20', 'synthetic', 'https://billing.example.test/preview-tokyo',
   1099511627776, 109951162777, unixepoch() - 1209600, unixepoch() + 1382400,
   42949672960, 8589934592, unixepoch() + 864000, 'Synthetic healthy profile', 'active',
   unixepoch() - 2592000, unixepoch() - 30, 5, 'USD', 30),
  ('profile-preview-seoul', 'Preview Seoul', '192.0.2.41', 'synthetic', 'https://billing.example.test/preview-seoul',
   536870912000, 515396075520, unixepoch() - 1209600, unixepoch() + 1382400,
   343597383680, 68719476736, unixepoch() + 172800, 'Synthetic incident profile', 'active',
   unixepoch() - 2592000, unixepoch() - 30, 5, 'USD', 30),
  ('profile-preview-catalog-only', 'Preview Catalog-only', '198.51.100.42', 'synthetic', NULL,
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Synthetic union-only profile', 'retired',
   unixepoch() - 2592000, unixepoch() - 30, NULL, NULL, NULL)
ON CONFLICT(id) DO UPDATE SET
  catalog_name = excluded.catalog_name,
  public_ip = excluded.public_ip,
  provider = excluded.provider,
  billing_url = excluded.billing_url,
  traffic_quota_bytes = excluded.traffic_quota_bytes,
  traffic_used_bytes = excluded.traffic_used_bytes,
  traffic_cycle_start = excluded.traffic_cycle_start,
  traffic_cycle_end = excluded.traffic_cycle_end,
  cycle_net_in = excluded.cycle_net_in,
  cycle_net_out = excluded.cycle_net_out,
  renews_at = excluded.renews_at,
  notes = excluded.notes,
  status = excluded.status,
  updated_at = excluded.updated_at,
  price = excluded.price,
  currency = excluded.currency,
  billing_cycle = excluded.billing_cycle;

INSERT INTO operations_live_snapshot(
  singleton_id, quality_json, agents_json, quality_updated_at, agents_updated_at, updated_at
) VALUES (
  1,
  '{"nodes":[{"name":"Preview Tokyo","host":"tokyo-preview.example.test","publicIp":"203.0.113.20","ok":true,"quality":"ok","riskKeywords":[],"routeKeywords":["synthetic"],"block":{"status":"OK","label":"Synthetic healthy"}},{"name":"Preview Seoul","host":"seoul-preview.example.test","publicIp":"192.0.2.41","ok":false,"quality":"poor","riskKeywords":["synthetic"],"routeKeywords":[],"block":{"status":"LIKELY_BLOCKED","label":"Synthetic incident"}}]}',
  '[{"name":"Preview Tokyo","os":"linux","arch":"x64","cpuName":"Synthetic CPU","cpu":22,"cpuCores":2,"memTotal":2147483648,"memUsed":805306368,"diskTotal":42949672960,"diskUsed":8589934592,"netIn":42949672960,"netOut":8589934592,"load1":0.4,"load5":0.3,"load15":0.2,"swapTotal":0,"swapUsed":0,"tcpConnections":42,"processes":120,"uptime":864000,"observedAt":0},{"name":"Preview Seoul","os":"linux","arch":"x64","cpuName":"Synthetic CPU","cpu":93,"cpuCores":2,"memTotal":2147483648,"memUsed":1932735283,"diskTotal":42949672960,"diskUsed":38654705664,"netIn":68719476736,"netOut":17179869184,"load1":3.8,"load5":2.9,"load15":2.2,"swapTotal":536870912,"swapUsed":268435456,"tcpConnections":390,"processes":260,"uptime":172800,"observedAt":0}]',
  unixepoch(), unixepoch(), unixepoch()
)
ON CONFLICT(singleton_id) DO UPDATE SET
  quality_json = excluded.quality_json,
  agents_json = excluded.agents_json,
  quality_updated_at = excluded.quality_updated_at,
  agents_updated_at = excluded.agents_updated_at,
  updated_at = excluded.updated_at;

INSERT INTO operations_agent_samples(
  node_name, observed_at, cpu, cpu_cores, mem_total, mem_used, disk_total, disk_used,
  net_in, net_out, load1, load5, load15, swap_total, swap_used, tcp_connections, processes, uptime
) VALUES
  ('Preview Tokyo', unixepoch() - 7200, 18, 2, 2147483648, 751619276, 42949672960, 8053063680, 40000000000, 8000000000, 0.3, 0.2, 0.2, 0, 0, 38, 118, 856800),
  ('Preview Tokyo', unixepoch() - 3600, 21, 2, 2147483648, 805306368, 42949672960, 8589934592, 42000000000, 8300000000, 0.4, 0.3, 0.2, 0, 0, 40, 119, 860400),
  ('Preview Tokyo', unixepoch() - 60, 22, 2, 2147483648, 805306368, 42949672960, 8589934592, 42949672960, 8589934592, 0.4, 0.3, 0.2, 0, 0, 42, 120, 864000),
  ('Preview Seoul', unixepoch() - 7200, 76, 2, 2147483648, 1717986918, 42949672960, 34359738368, 64000000000, 16000000000, 2.8, 2.1, 1.7, 536870912, 134217728, 310, 240, 165600),
  ('Preview Seoul', unixepoch() - 3600, 88, 2, 2147483648, 1825361100, 42949672960, 37580963840, 66000000000, 16500000000, 3.3, 2.6, 2, 536870912, 201326592, 360, 250, 169200),
  ('Preview Seoul', unixepoch() - 60, 93, 2, 2147483648, 1932735283, 42949672960, 38654705664, 68719476736, 17179869184, 3.8, 2.9, 2.2, 536870912, 268435456, 390, 260, 172800);

INSERT INTO operations_agent_rollups(
  node_name, resolution_seconds, bucket_at, samples, rollup_writer_version, sample_counts_exact,
  cpu_samples, mem_used_samples, disk_used_samples, load1_samples, swap_used_samples, tcp_samples,
  cpu_avg, mem_used_avg, mem_total, disk_used_avg, disk_total, load1_avg,
  net_in_last, net_out_last, swap_used_avg, tcp_avg
) VALUES
  ('Preview Tokyo', 300, CAST((unixepoch() - 259200) / 300 AS INTEGER) * 300, 12, 2, 1, 12, 12, 12, 12, 12, 12,
   20, 780000000, 2147483648, 8300000000, 42949672960, 0.35, 36000000000, 7000000000, 0, 36),
  ('Preview Seoul', 300, CAST((unixepoch() - 259200) / 300 AS INTEGER) * 300, 12, 2, 1, 12, 12, 12, 12, 12, 12,
   82, 1750000000, 2147483648, 35000000000, 42949672960, 2.5, 60000000000, 15000000000, 160000000, 300),
  ('Preview Tokyo', 3600, CAST((unixepoch() - 2592000) / 3600 AS INTEGER) * 3600, 48, 2, 1, 48, 48, 48, 48, 48, 48,
   17, 700000000, 2147483648, 7600000000, 42949672960, 0.25, 28000000000, 5000000000, 0, 30),
  ('Preview Seoul', 3600, CAST((unixepoch() - 2592000) / 3600 AS INTEGER) * 3600, 48, 2, 1, 48, 48, 48, 48, 48, 48,
   68, 1500000000, 2147483648, 30000000000, 42949672960, 1.9, 48000000000, 12000000000, 90000000, 240)
ON CONFLICT(node_name, resolution_seconds, bucket_at) DO UPDATE SET
  samples = excluded.samples,
  rollup_writer_version = excluded.rollup_writer_version,
  sample_counts_exact = excluded.sample_counts_exact,
  cpu_samples = excluded.cpu_samples,
  mem_used_samples = excluded.mem_used_samples,
  disk_used_samples = excluded.disk_used_samples,
  load1_samples = excluded.load1_samples,
  swap_used_samples = excluded.swap_used_samples,
  tcp_samples = excluded.tcp_samples,
  cpu_avg = excluded.cpu_avg,
  mem_used_avg = excluded.mem_used_avg,
  mem_total = excluded.mem_total,
  disk_used_avg = excluded.disk_used_avg,
  disk_total = excluded.disk_total,
  load1_avg = excluded.load1_avg,
  net_in_last = excluded.net_in_last,
  net_out_last = excluded.net_out_last,
  swap_used_avg = excluded.swap_used_avg,
  tcp_avg = excluded.tcp_avg;

INSERT INTO operations_quality_samples(node_name, observed_at, ok, quality, block_status)
VALUES
  ('Preview Tokyo', CAST(unixepoch() / 60 AS INTEGER) * 60, 1, 'ok', 'OK'),
  ('Preview Seoul', CAST(unixepoch() / 60 AS INTEGER) * 60, 0, 'poor', 'LIKELY_BLOCKED')
ON CONFLICT(node_name, observed_at) DO UPDATE SET
  ok = excluded.ok,
  quality = excluded.quality,
  block_status = excluded.block_status;

INSERT INTO operations_home_probe_samples(home_exit_id, probed_at, status)
VALUES
  ('home-preview-alpha', CAST((unixepoch() - 3600) / 60 AS INTEGER) * 60, 'alive'),
  ('home-preview-alpha', CAST(unixepoch() / 60 AS INTEGER) * 60, 'alive')
ON CONFLICT(home_exit_id, probed_at) DO UPDATE SET status = excluded.status;

INSERT INTO telemetry_windows(
  id, user_id, received_at, window_start_ms, window_end_ms, client_version, os_version, payload_json, device_id
) VALUES
  ('telemetry-preview-alpha', 'usr-preview-alpha', unixepoch() - 30,
   (unixepoch() - 1230) * 1000, (unixepoch() - 30) * 1000, 'preview', 'macOS preview',
   '{"selectedServer":"Preview Tokyo","uiState":"connected","catalogRevision":0,"exitDelayMs":80,"tcpDelayMs":35,"exitDelayAtMs":0,"tcpDelayAtMs":0}', 'dev-preview-alpha'),
  ('telemetry-preview-beta', 'usr-preview-beta', unixepoch() - 15,
   (unixepoch() - 1215) * 1000, (unixepoch() - 15) * 1000, 'preview', 'Windows preview',
   '{"selectedServer":"Preview Seoul","uiState":"connected","catalogRevision":0,"exitDelayMs":920,"tcpDelayMs":40,"exitDelayAtMs":0,"tcpDelayAtMs":0}', 'dev-preview-beta');
`;

// Run this after the normal seed to exercise the UI's partial-source-failure
// state. Re-running previewSeedSql restores the healthy agent source.
export const partialSourceFailureSql = String.raw`
UPDATE operations_live_snapshot
SET agents_json = NULL,
    agents_updated_at = NULL,
    updated_at = unixepoch()
WHERE singleton_id = 1;
`;
