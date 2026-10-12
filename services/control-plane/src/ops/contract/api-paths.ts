// 控制面路径：最近 7 天每个客户 ASN 走了哪条路径、成功率多少（决策 080）。

import { arrayOf, fields, int, measured, measuredOptNum, oneOf, optInt, optText } from './checkers';
import type { Measured } from './vocabulary';

/** The `X-Tono-Path` / `X-Tono-Path-Failed` vocabulary (decision 077); anything else is dropped at intake. */
export const API_PATH_KINDS = ['pinned', 'system_dns', 'relay', 'doh', 'alt_port', 'tunnel'] as const;
export type ApiPathKind = (typeof API_PATH_KINDS)[number];

/**
 * One client ASN on one path over the window.
 *
 * `asn` is null when it is not the customer's: a relayed or tunnelled request,
 * or one from a known exit ASN, arrives from a Tono node's address. `arrived`
 * counts stamped requests from every client (at most one per device per path
 * per hour). `ok` / `fail` come only from clients that send
 * `X-Tono-Path-Failed`; `successRate` is `ok / (ok + fail)` and stays null
 * (never 100 %) while no reporting client has used the path.
 */
export interface ApiPathRowDto {
  asn: number | null;
  asOrg: string | null;
  path: ApiPathKind;
  arrived: number;
  ok: number;
  fail: number;
  successRate: Measured<number | null>;
}

/** `since` is the first UTC day (epoch seconds) in the window; `days` its length. */
export interface ApiPathsDto {
  since: number;
  days: number;
  rows: ApiPathRowDto[];
}

const ROW_KEYS = ['asn', 'asOrg', 'path', 'arrived', 'ok', 'fail', 'successRate'] as const;

export function assertApiPathRow(value: unknown, path = 'apiPath'): ApiPathRowDto {
  const row = fields(value, path, ROW_KEYS);
  return {
    asn: optInt(row, path, 'asn'),
    asOrg: optText(row, path, 'asOrg'),
    path: oneOf<ApiPathKind>(row, path, 'path', API_PATH_KINDS),
    arrived: int(row, path, 'arrived'),
    ok: int(row, path, 'ok'),
    fail: int(row, path, 'fail'),
    successRate: measured(row, path, 'successRate', measuredOptNum),
  };
}

export function assertApiPaths(value: unknown, path = 'apiPaths'): ApiPathsDto {
  const row = fields(value, path, ['since', 'days', 'rows']);
  return {
    since: int(row, path, 'since'),
    days: int(row, path, 'days'),
    rows: arrayOf(row, path, 'rows', assertApiPathRow),
  };
}
