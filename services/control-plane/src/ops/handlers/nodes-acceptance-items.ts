// 可售验收单上的每一条，以及它凭什么是这个答案。
//
// Pure functions, one per line of the sheet: they take facts that have already
// been read and return the item. Nothing here touches D1 or the live snapshot,
// which is what lets the whole table be tested case by case — a state that only
// appears when three queries line up is a state nobody ever checks.
//
// Three states rather than two. `fail` is a measurement that came back bad,
// `unknown` is a measurement nobody has taken, and `pending` is one that has
// been asked for and has not answered yet. Two items may stay `unknown` and
// still let a node be sold — 客户去程 and 容量 — because both need a real
// customer, and a node nobody has been given cannot produce one. Every other
// unknown is a blocker: it is the operator's job to go and measure it, not the
// sheet's job to assume.

import type {
  AcceptanceItemDto,
  AcceptanceState,
  CarrierKey,
  ForwardPathDto,
  NodeBindingsDto,
  NodeErrorRowDto,
  NodeFactsDto,
  NodeOccupantDto,
  NodeQuotaDto,
  ReturnPathDto,
  SourceId,
} from '../contract';

export const DAY = 86_400;
/** The hub sweeps once a day; 26 h is one late run, not a second missed one. */
const SWEEP_FRESH_SEC = 26 * 3_600;
/** How far back a real customer counts as proof that the forward path works. */
export const CUSTOMER_WINDOW_SEC = 7 * DAY;
/** The floor the verdict engine already calls a spike; the sheet uses the same one. */
const ERROR_DEGRADED = 10;
const GB = 1000 ** 3;

/** The three that decide whether a mainland customer can use the machine. */
const MAINLAND: readonly CarrierKey[] = ['unicom', 'telecom', 'mobile'];
const CARRIER_WORD: Record<CarrierKey, string> = {
  unicom: '联通',
  telecom: '电信',
  mobile: '移动',
  other: '其他',
};

/** The two questions that need a customer nobody has given this machine yet. */
export const NEEDS_A_CUSTOMER = new Set(['forward', 'capacity']);

/** The two jobs whose success proves the digest has ever looked at this node. */
export const DIGEST_TYPES = ['xray_error_digest', 'xray_dial_errors'];

function item(
  key: string,
  label: string,
  state: AcceptanceState,
  evidence: string | null,
  asOfSec: number | null,
  source: SourceId,
): AcceptanceItemDto {
  return { key, label, state, evidence, asOfSec: asOfSec != null && asOfSec > 0 ? asOfSec : null, source };
}

/** 小时 rather than seconds: nobody reads a staleness in seconds. */
function hoursAgo(asOf: number, t: number): string {
  return String(Math.max(1, Math.floor((t - asOf) / 3_600)));
}

function pct(value: number): string {
  return String(Math.round(value * 100));
}

/* --------------------------------------------------------------- 资料齐全 */

/**
 * The hand-kept half: who sold it, what it costs, when it lapses, and what
 * line it is on. None of it is measured, all of it decides whether the machine
 * can be sold to anyone, and every dash here is a dash until somebody types
 * the answer — so a missing field is a `fail`, never an `unknown`.
 */
export function profileItem(facts: NodeFactsDto): AcceptanceItemDto {
  const missing: string[] = [];
  if (facts.provider === null) missing.push('商家');
  if (facts.price === null) missing.push('价格');
  if (facts.renewsAt === null && facts.expiresAt === null) missing.push('续费日或到期日');
  if (facts.lineTags.length === 0) missing.push('线路标签');
  return item(
    'profile', '资料齐全',
    missing.length === 0 ? 'pass' : 'fail',
    missing.length === 0
      ? `${facts.provider}，价格、续费和线路标签都填过了`
      : `还没填：${missing.join('、')}`,
    facts.updatedAt, 'profile',
  );
}

/* --------------------------------------------------------------- 五处登记 */

const BINDING_ITEMS: ReadonlyArray<{
  key: string;
  label: string;
  field: keyof Omit<NodeBindingsDto, 'asOfSec'>;
  source: SourceId;
  done: string;
  todo: string;
}> = [
  {
    key: 'binding.catalog', label: '目录登记', field: 'catalog', source: 'catalog',
    done: '在客户端的节点单子里', todo: '还不在客户端的节点单子里',
  },
  {
    key: 'binding.exitToken', label: '出口令牌', field: 'exitToken', source: 'telemetry',
    done: '最近取过出口令牌', todo: '最近没有取过出口令牌',
  },
  {
    key: 'binding.komari', label: '探针', field: 'komari', source: 'komari',
    done: '探针在报数', todo: '这台机器上没有探针在报数',
  },
  {
    key: 'binding.identitySync', label: '身份同步', field: 'identitySync', source: 'telemetry',
    done: '取过账号名单', todo: '还没取过账号名单',
  },
  {
    key: 'binding.metering', label: '计量', field: 'metering', source: 'telemetry',
    done: '计量最近上报过', todo: '计量最近没有上报',
  },
];

/**
 * One item per registration rather than one for all five, because 上架 is
 * refused per reason: an operator told "五处登记还差一处" has to go and find
 * out which, and the whole sheet exists so nobody has to.
 */
export function bindingItems(bindings: NodeBindingsDto, listed: boolean | null): AcceptanceItemDto[] {
  return BINDING_ITEMS.map((row) => {
    if (row.field === 'catalog' && listed === null) {
      return item(row.key, row.label, 'unknown', '目录读不出来，说不准在不在单子里', bindings.asOfSec, row.source);
    }
    const done = bindings[row.field];
    return item(row.key, row.label, done ? 'pass' : 'fail', done ? row.done : row.todo, bindings.asOfSec, row.source);
  });
}

/* ----------------------------------------------------------- 大陆三网探测 */

/**
 * The hub's own sweep, per carrier, and the block verdict beside it.
 *
 * Fresh matters as much as good here: a sweep from three days ago says what
 * was true three days ago, and a node that was walled yesterday still shows
 * yesterday's clean numbers. A queued 重测大陆可达 makes this `pending` rather
 * than `unknown` — the answer is on its way, and overriding past it is exactly
 * the mistake the sheet is for.
 */
export function carriersItem(
  ret: { rows: ReturnPathDto[]; asOf: number | null },
  blockLabel: string | null,
  probePending: boolean,
  t: number,
): AcceptanceItemDto {
  const key = 'carriers';
  const label = '大陆三网探测';
  const rows = ret.rows.filter((row) => MAINLAND.includes(row.carrier));
  const seen = rows.filter((row) => row.samples > 0);
  if (probePending) {
    return item(key, label, 'pending', '重测大陆可达已经排队，等这一轮结果', ret.asOf, 'komari');
  }
  if (ret.asOf === null || seen.length === 0) {
    return item(key, label, 'unknown', '中控机还没扫过这台机器', null, 'komari');
  }
  if (t - ret.asOf > SWEEP_FRESH_SEC) {
    return item(key, label, 'fail', `上一轮探测已经是 ${hoursAgo(ret.asOf, t)} 小时前了`, ret.asOf, 'komari');
  }
  if (blockLabel !== null) {
    return item(key, label, 'fail', `扫描说这台机器${blockLabel}`, ret.asOf, 'collector');
  }
  const untested = MAINLAND.filter((carrier) => !seen.some((row) => row.carrier === carrier));
  if (untested.length > 0) {
    return item(
      key, label, 'fail',
      `${untested.map((carrier) => CARRIER_WORD[carrier]).join('、')}这一轮没测到`,
      ret.asOf, 'komari',
    );
  }
  const said = seen
    .map((row) => `${CARRIER_WORD[row.carrier]}丢包 ${row.lossPct === null ? '未知' : `${pct(row.lossPct)}%`}`)
    .join('，');
  return item(key, label, 'pass', `三网都测到了：${said}`, ret.asOf, 'komari');
}

/* --------------------------------------------------------------- 客户去程 */

/**
 * The direction that actually decides whether a customer can connect, and the
 * one item a brand-new machine is allowed to leave open: nobody has been given
 * this node yet, so nobody has tried. A machine customers have tried and
 * failed on is a different answer entirely, and fails.
 */
export function forwardItem(
  forward: { rows: ForwardPathDto[]; asOf: number | null },
): AcceptanceItemDto {
  const key = 'forward';
  const label = '客户去程';
  const rows = forward.rows.filter((row) => MAINLAND.includes(row.carrier));
  let attempts = 0;
  let ok = 0;
  for (const row of rows) {
    attempts += row.attempts;
    ok += Math.round((row.successRate ?? 0) * row.attempts);
  }
  if (attempts === 0) {
    return item(key, label, 'unknown', '还没有客户连过', null, 'telemetry');
  }
  if (ok === 0) {
    return item(key, label, 'fail', `大陆客户试了 ${attempts} 次，一次都没连上`, forward.asOf, 'telemetry');
  }
  return item(key, label, 'pass', `最近 7 天大陆客户连上过 ${ok} 次`, forward.asOf, 'telemetry');
}

/* ------------------------------------------------------------- 后台无报错 */

/**
 * The digest, and whether it has ever run.
 *
 * An empty table is not the same as a quiet machine: the digest only writes a
 * row when there is something to write, so "no rows" on a node nobody has
 * pulled errors from proves nothing. The last successful digest job is what
 * separates the two, and it is a fact the queue already keeps.
 */
export function errorsItem(
  rows: readonly NodeErrorRowDto[],
  digestAt: number | null,
  t: number,
): AcceptanceItemDto {
  const key = 'errors';
  const label = '后台无报错';
  if (digestAt === null) {
    return item(key, label, 'unknown', '还没拉过这台机器的后台报错', null, 'jobs');
  }
  const since = Math.floor(t / DAY) * DAY;
  const today = rows.filter((row) => row.dayAt >= since);
  const count = today.reduce((sum, row) => sum + row.count, 0);
  if (count >= ERROR_DEGRADED) {
    const worst = [...today].sort((a, b) => b.count - a.count)[0];
    return item(
      key, label, 'fail',
      `最近一天有 ${count} 条后台报错，最多的是 ${worst?.category ?? '未知'}`,
      digestAt, 'jobs',
    );
  }
  return item(key, label, 'pass', `最近一天 ${count} 条后台报错`, digestAt, 'jobs');
}

/* --------------------------------------------------------- 流量配额已设 */

/** No allowance and no cycle means nothing stops this machine running the bill up. */
export function quotaItem(quota: NodeQuotaDto, asOf: number | null): AcceptanceItemDto {
  const key = 'quota';
  const label = '流量配额已设';
  if (quota.quota === null || quota.cycleStart === null || quota.cycleEnd === null) {
    return item(key, label, 'fail', '还没登记流量额度和周期', asOf, 'profile');
  }
  return item(
    key, label, 'pass',
    `额度 ${Math.round(quota.quota / GB)} GB，周期已经在走`,
    asOf, 'profile',
  );
}

/* ------------------------------------------------------------------ 容量 */

/**
 * How much room is left on the machine.
 *
 * Nothing writes down what this box can hold — there is no ceiling on the
 * profile — so the honest answer is `unknown` with the live count beside it,
 * never a green tick derived from a number nobody has ever set. It is one of
 * the two items that may stay unknown and still let a node be sold.
 */
export function capacityItem(occ: { rows: NodeOccupantDto[]; asOf: number | null }): AcceptanceItemDto {
  const key = 'capacity';
  const label = '容量';
  if (occ.asOf === null) {
    return item(key, label, 'unknown', '还没登记这台机器坐得下多少人，现在也没测到有人在用', null, 'profile');
  }
  return item(
    key, label, 'unknown',
    `现在 ${occ.rows.length} 人在用，但还没登记这台机器坐得下多少人`,
    occ.asOf, 'profile',
  );
}

/* -------------------------------------------------------------- 替代机器 */

/**
 * Who covers for this machine when it goes.
 *
 * Same region, still in the catalog, and not this node — the region is compared
 * as it was typed, trimmed and case-folded, because that is the only grouping
 * anybody has written down. A machine with no region recorded cannot answer
 * the question at all, which is a `fail` on the profile rather than an unknown.
 */
export function standbyItem(
  region: string | null,
  siblings: string[],
  names: Set<string> | null,
  t: number,
): AcceptanceItemDto {
  const key = 'standby';
  const label = '替代机器';
  if (names === null) {
    return item(key, label, 'unknown', '目录读不出来，点不出替代机器', null, 'catalog');
  }
  if (region === null) {
    return item(key, label, 'fail', '还没登记地区，说不出哪台机器能替它', t, 'catalog');
  }
  if (siblings.length === 0) {
    return item(key, label, 'fail', `${region} 没有第二台在售的机器`, t, 'catalog');
  }
  return item(
    key, label, 'pass',
    `${region} 还有 ${siblings.length} 台在售：${siblings.slice(0, 2).join('、')}`,
    t, 'catalog',
  );
}
