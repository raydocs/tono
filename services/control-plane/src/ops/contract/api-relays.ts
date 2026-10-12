// API 中继：Tono 自有的 API 中继端口还开着吗（决策 077）。

import { arrayOf, bool, fields, int, optBool, optInt, optText, text } from './checkers';

/**
 * The relay node's own last full HTTPS request through its local relay port to
 * the API, certificate verification on (`tooling/ops/relay/relay-probe.py`).
 * `observedAt` is when the node ran it; the console shows its age, so a node
 * that stopped reporting reads as stale, not as up.
 */
export interface ApiRelayEndToEndDto {
  ok: boolean;
  observedAt: number;
  httpStatus: number | null;
  latencyMs: number | null;
  error: string | null;
  okSince: number | null;
  failingSince: number | null;
}

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
  /** Absent until the relay node has reported once. */
  endToEnd?: ApiRelayEndToEndDto;
}

export interface ApiRelaysDto {
  relays: ApiRelayDto[];
}

const RELAY_KEYS = [
  'name', 'host', 'port', 'ok', 'checkedAt', 'latencyMs', 'error', 'okSince', 'failingSince', 'endToEnd',
] as const;

const END_TO_END_KEYS = [
  'ok', 'observedAt', 'httpStatus', 'latencyMs', 'error', 'okSince', 'failingSince',
] as const;

export function assertApiRelayEndToEnd(value: unknown, path = 'endToEnd'): ApiRelayEndToEndDto {
  const row = fields(value, path, END_TO_END_KEYS);
  return {
    ok: bool(row, path, 'ok'),
    observedAt: int(row, path, 'observedAt'),
    httpStatus: optInt(row, path, 'httpStatus'),
    latencyMs: optInt(row, path, 'latencyMs'),
    error: optText(row, path, 'error'),
    okSince: optInt(row, path, 'okSince'),
    failingSince: optInt(row, path, 'failingSince'),
  };
}

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
    ...(row.endToEnd === undefined ? {} : { endToEnd: assertApiRelayEndToEnd(row.endToEnd, `${path}.endToEnd`) }),
  };
}

export function assertApiRelays(value: unknown, path = 'apiRelays'): ApiRelaysDto {
  const row = fields(value, path, ['relays']);
  return { relays: arrayOf(row, path, 'relays', assertApiRelay) };
}
