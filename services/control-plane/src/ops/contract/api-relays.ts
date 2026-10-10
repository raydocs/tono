// API 中继：Tono 自有的 API 中继端口还开着吗（决策 077）。

import { arrayOf, fields, int, optBool, optInt, optText, text } from './checkers';

/**
 * One compiled relay and the cron's last TCP check of it.
 *
 * `ok` is null until the first check lands. The check is a TCP open only — a
 * Worker cannot set the SNI the relay admits on — so `ok` says the port
 * answered, not that a client's TLS went through. `okSince` / `failingSince`
 * are the start of the current run of successes or failures.
 */
export interface ApiRelayDto {
  name: string;
  host: string;
  port: number;
  ok: boolean | null;
  checkedAt: number | null;
  latencyMs: number | null;
  error: string | null;
  okSince: number | null;
  failingSince: number | null;
}

export interface ApiRelaysDto {
  relays: ApiRelayDto[];
}

const RELAY_KEYS = [
  'name', 'host', 'port', 'ok', 'checkedAt', 'latencyMs', 'error', 'okSince', 'failingSince',
] as const;

export function assertApiRelay(value: unknown, path = 'apiRelay'): ApiRelayDto {
  const row = fields(value, path, RELAY_KEYS);
  return {
    name: text(row, path, 'name'),
    host: text(row, path, 'host'),
    port: int(row, path, 'port'),
    ok: optBool(row, path, 'ok'),
    checkedAt: optInt(row, path, 'checkedAt'),
    latencyMs: optInt(row, path, 'latencyMs'),
    error: optText(row, path, 'error'),
    okSince: optInt(row, path, 'okSince'),
    failingSince: optInt(row, path, 'failingSince'),
  };
}

export function assertApiRelays(value: unknown, path = 'apiRelays'): ApiRelaysDto {
  const row = fields(value, path, ['relays']);
  return { relays: arrayOf(row, path, 'relays', assertApiRelay) };
}
