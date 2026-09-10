#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLOCK = 1_725_000_000;
const DAY = 86_400;
const HOUR = 3_600;
const GiB = 1024 ** 3;
const HOUR_FLOOR = Math.floor(CLOCK / HOUR) * HOUR;

const SOURCE_IDS = ['collector', 'komari', 'telemetry', 'catalog', 'profile', 'engine', 'jobs', 'manual'];
const EVENT_SOURCES = ['window', 'direct', 'diagnostics', 'failure'];
const SERVICE_FAMILIES = ['claude', 'chatgpt', 'grok', 'gemini', 'meta', 'other'];
const JOB_TYPES = [
  'xray_dial_errors', 'xray_error_digest', 'collect_quality', 'node_probe',
  'node_config_snapshot', 'xray_restart', 'identity_sync', 'agent_reinstall',
  'catalog_retire', 'catalog_relist', 'home_line_probe',
];
const JOB_STATUSES = ['queued', 'leased', 'succeeded', 'failed', 'cancelled', 'expired'];
const JOB_EXECUTORS = ['hub', 'exit_agent', 'worker'];
const SUBJECT_TYPES = ['node', 'user', 'home_exit', 'fleet'];
const SEVERITIES = ['severe', 'warn', 'notice'];
const STAGES = ['dial', 'handshake', 'tls', 'catalog', 'probe'];
const FAIL_CODES = [
  'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'TLS_HANDSHAKE_TIMEOUT',
  'REALITY_AUTH_FAIL', 'CATALOG_STALE', 'DNS_FAIL',
];
const FAIL_ERRORS = [
  'dial tcp ***:443: connect: connection refused',
  'dial tcp ***:443: i/o timeout',
  'read tcp ***:443: i/o timeout',
  'tls: handshake timed out',
  'reality: auth failed',
  'dns: lookup ***: no such host',
];

const FUNNEL_STAGES = ['invited', 'registered', 'device_added', 'reported', 'connected'];

const HEALTH_BY_VERDICT = {
  unreachable: { health: '连不上', tone: 'sev' },
  unstable: { health: '不稳', tone: 'warn' },
  never_used: { health: '还没用起来', tone: 'unk' },
  unreported: { health: '未上报', tone: 'unk' },
  offline: { health: '离线', tone: 'info' },
  ok: { health: '正常', tone: 'ok' },
};

const FEATURED_NODES = [
  'Tokyo · Fuji',
  'Los Angeles · Mesa',
  'Hong Kong · Victoria',
  'Singapore · Harbour（新加坡海港 · 大陆直连 · CMIN2）',
  '香港 · 中环',
  '东京 · 渋谷',
];

const LONG_NODES = [
  'Los Angeles · Pacific-Coast-Highway-Backhaul-01',
  'Frankfurt · Main · eu-central-1a-secondary · 法兰克福备用出口',
  'Singapore · Harbour（新加坡海港 · 大陆直连 · CMIN2）',
];

const CARRIERS = [
  { org: 'China Mobile', asn: 9808, regions: ['江苏', '上海'] },
  { org: 'China Unicom', asn: 4837, regions: ['北京', '江苏'] },
  { org: 'China Telecom', asn: 4134, regions: ['上海', '广东'] },
];

const EMAILS_20 = [
  'chen.jie@example.com',
  'zhang.min@example.com',
  'liu.yang@example.com',
  'wang.tao@example.com',
  'zhao.lei@example.com',
  'sun.yan@example.com',
  'zhou.hao@example.com',
  'wu.jing@example.com',
  'zheng.xin@example.com',
  'feng.yu@example.com',
  'chen.lin@example.com',
  'lin.xia@example.com',
  'huang.wei@example.com',
  'xu.na@example.com',
  'he.jun@example.com',
  'gao.mei@example.com',
  'ma.qiang@example.com',
  'luo.ting@example.com',
  'song.kai@example.com',
  'deng.fang@example.com',
];

const VERDICT_20 = {
  'u-04': 'unreachable',
  'u-02': 'unstable', 'u-09': 'unstable', 'u-15': 'unstable',
  'u-06': 'never_used', 'u-11': 'never_used', 'u-17': 'never_used',
  'u-20': 'unreported',
  'u-01': 'offline', 'u-03': 'offline', 'u-05': 'offline', 'u-08': 'offline',
  'u-12': 'offline', 'u-14': 'offline', 'u-18': 'offline', 'u-19': 'offline',
  'u-07': 'ok', 'u-10': 'ok', 'u-13': 'ok', 'u-16': 'ok',
};

/**
 * 开通了、从来没连上过的三位，一人卡在一步。
 *
 * 页面上四段漏斗里除了"连上过"的那三段，各要有人站着，不然点进去是一张空表，
 * 而空表证明不了筛选是对的。日子也各不相同：两位卡了三天以上，会变成待办；
 * 名单上那两位里也留了一位刚开通的，好证明三天这条线真的在拦。
 */
const STAGE_20 = {
  'u-06': { stage: 'registered', days: 5 },
  'u-11': { stage: 'device_added', days: 4 },
  'u-17': { stage: 'reported', days: 9 },
};

/** 名单上的两位：开通了，从来没在客户端登录过，所以没有账号。 */
const INVITED = [
  {
    email: 'shu.qing@example.com',
    wechatId: 'wx_shu_qing',
    contact: '+86 137 5521 8802',
    notes: '朋友介绍的，开通后一直没动静。',
    days: 6,
  },
  {
    email: 'tan.wei@example.com',
    wechatId: null,
    contact: null,
    notes: null,
    days: 2,
  },
];

const REASON_20 = {
  'u-04': '30 分钟内 3 次连接失败，之后没有成功',
  'u-02': '今天已经换了 4 个节点，延迟一直在抖',
  'u-09': '近一小时握手失败和成功交替出现',
  'u-15': '节点来回切了三次，每次都只撑了几分钟',
  'u-06': '注册之后一直没装客户端',
  'u-11': '装了客户端，从来没有上报过',
  'u-17': '上报过几次，但一次也没连上',
  'u-20': '套餐已到期，客户端不再上报',
  'u-01': '昨晚 23 点后一直离线',
  'u-03': '今早 8 点后没有再连上',
  'u-05': '下午断线后没有重连',
  'u-08': '超过 6 小时没有在线记录',
  'u-12': '昨天夜里掉线，之后没有上线',
  'u-14': '中午之后一直离线',
  'u-18': '晚高峰过后没有再出现',
  'u-19': '连续两晚这个点之后离线',
};

const SERVER_20 = {
  'u-01': 'Tokyo · Fuji',
  'u-02': '香港 · 中环',
  'u-03': 'Hong Kong · Victoria',
  'u-04': 'Los Angeles · Mesa',
  'u-05': '东京 · 渋谷',
  'u-07': 'Tokyo · Fuji',
  'u-08': 'Singapore · Harbour（新加坡海港 · 大陆直连 · CMIN2）',
  'u-09': '香港 · 中环',
  'u-10': 'Hong Kong · Victoria',
  'u-12': '东京 · 渋谷',
  'u-13': 'Tokyo · Fuji',
  'u-14': 'Los Angeles · Mesa',
  'u-15': 'Singapore · Harbour（新加坡海港 · 大陆直连 · CMIN2）',
  'u-16': '香港 · 中环',
  'u-18': 'Hong Kong · Victoria',
  'u-19': '东京 · 渋谷',
};

const HAS_FAILURE = new Set(['u-04', 'u-02', 'u-09', 'u-15', 'u-01', 'u-08']);
const NULL_QUOTA = new Set(['u-08', 'u-14', 'u-19']);

const CLOUD_DESTINATIONS = [
  'claude.ai', 'openai.com', 'x.ai', 'facebook.com', 'google.com', 'github.com', 'cloudflare.com',
  'bilibili.com', 'zhihu.com', 'taobao.com', 'jd.com', 'weibo.com', 'qq.com', '163.com',
  'youtube.com', 'twitter.com', 'instagram.com', 'reddit.com', 'netflix.com', 'amazon.com',
  'apple.com', 'microsoft.com', 'wikipedia.org', 'discord.com',
];
const RESIDENTIAL_DESTINATIONS = ['twitch.tv', 'spotify.com', 'dropbox.com'];
const DIRECT_DESTINATIONS = ['baidu.com', '126.com'];
const REJECT_DESTINATIONS = ['doubleclick.net'];
const EXTRA_DESTINATIONS = [
  'notion.so', 'figma.com', 'linear.app', 'vercel.com', 'npmjs.com',
  'pypi.org', 'stackoverflow.com', 'medium.com', 'linkedin.com', 'zoom.us',
];
const PROCESSES = ['Chrome', 'Safari', 'Cursor', 'Code', 'Slack', '微信', 'Notion', 'DingTalk'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngFor(seed) {
  return mulberry32(seed >>> 0);
}

function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function pickN(rng, list, n) {
  const copy = list.slice();
  const out = [];
  const count = Math.min(n, copy.length);
  for (let i = 0; i < count; i += 1) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function userId(n) {
  return `u-${String(n).padStart(2, '0')}`;
}

function measured(value, asOfSec, source = 'telemetry') {
  return { value, asOfSec, source };
}

function listOf(items, updatedAt = CLOCK) {
  return {
    items,
    nextCursor: null,
    total: items.length,
    updatedAt,
  };
}

function hourOfDay(hourAt) {
  return Math.floor(((hourAt % DAY) + DAY) % DAY / HOUR);
}

/**
 * 从来没连上过的人：不管是还没上报，还是上报了连不上，能测的都还没测过。
 *
 * 未上报和还没用起来在夹具里长得一样——没有设备、没有连接、没有用量——但含义
 * 不同：一个是用过之后不说话了，一个是从头到尾没用起来。所以判定分开写，
 * 而"这些字段还是空的"这件事共用一个判断。
 */
function quiet(verdict) {
  return verdict === 'unreported' || verdict === 'never_used';
}

function stageOf(id, verdict) {
  if (STAGE_20[id]) return STAGE_20[id].stage;
  return verdict === 'never_used' ? 'registered' : 'connected';
}

function lifecycleFor(id) {
  if (id === 'u-11') return 'suspended';
  if (id === 'u-20') return 'expired';
  return 'active';
}

function platformsFor(id, index) {
  // 装了客户端的那两位有平台，注册了还没装的那位没有。
  const stage = STAGE_20[id]?.stage;
  if (stage === 'device_added' || stage === 'reported') return ['macos'];
  if (quiet(VERDICT_20[id])) return [];
  if (id === 'u-04') return ['macos', 'windows'];
  const sets = [['macos'], ['windows'], ['macos', 'windows']];
  return sets[index % 3];
}

function servicesFor(id, index, rng) {
  if (quiet(VERDICT_20[id])) return [];
  const forced = {
    'u-07': ['claude', 'chatgpt'],
    'u-10': ['chatgpt', 'grok'],
    'u-13': ['grok', 'meta'],
    'u-16': ['meta', 'claude', 'other'],
    'u-04': ['claude', 'chatgpt', 'grok', 'meta'],
  };
  if (forced[id]) return forced[id];
  const count = randInt(rng, 2, 4);
  return pickN(rng, SERVICE_FAMILIES, count);
}

/**
 * How the operator actually reaches these people.
 *
 * Most of them gave a WeChat id, which is why the console shows the column at
 * all; every ninth one never did, so the list, the 360 header and ⌘K all have
 * a customer with nothing there to be tested against. The handle is built off
 * the address so a reader can tell at a glance which row it belongs to, and
 * the dense set's very long addresses make correspondingly long handles — that
 * column has to truncate rather than push the address column off the page.
 */
function wechatFor(index, email) {
  if (index % 9 === 0) return null;
  const local = String(email).split('@')[0].replace(/[^a-z0-9]+/g, '_');
  return `wx_${local.slice(0, 24)}`;
}

/** A phone number for the few who left one, beside a note somebody wrote. */
function contactFor(index) {
  if (index % 4 !== 0) return null;
  return `+86 138 ${String(1000 + index * 7)} ${String(2000 + index)}`;
}

const NOTE_LINES = [
  '朋友介绍来的，续费从来不用催。',
  '公司报销，发票抬头要开公司的。',
  '只在晚上用，白天掉线不用管。',
  '换过一次手机，旧设备还没退。',
  '按季度付，下次提前一周提醒。',
];

function notesFor(index) {
  if (index % 4 !== 0) return null;
  return NOTE_LINES[(index / 4 - 1) % NOTE_LINES.length];
}

function expiresAtFor(id, index) {
  if (id === 'u-04') return CLOCK + 20 * DAY;
  if (id === 'u-05') return CLOCK + 4 * DAY;
  if (id === 'u-12') return CLOCK + 8 * DAY;
  if (id === 'u-20') return CLOCK - 12 * DAY;
  return CLOCK + (18 + (index % 40)) * DAY;
}

function quotaFor(id) {
  if (NULL_QUOTA.has(id)) return null;
  if (id === 'u-01') return 50 * GiB;
  if (id === 'u-03') return 100 * GiB;
  if (id === 'u-04') return 200 * GiB;
  return (80 + (id.charCodeAt(3) % 8) * 20) * GiB;
}

function usageFor(id, quota, rng) {
  if (quiet(VERDICT_20[id])) return measured(0, null, 'telemetry');
  const asOf = CLOCK - randInt(rng, 60, 1800);
  if (id === 'u-01') return measured(55 * GiB, asOf, 'telemetry');
  if (id === 'u-03') return measured(93 * GiB, asOf, 'telemetry');
  if (id === 'u-04') return measured(45 * GiB, asOf, 'telemetry');
  if (quota === null) return measured(randInt(rng, 2, 20) * GiB, asOf, 'telemetry');
  const pct = randInt(rng, 12, 78);
  return measured(Math.floor((quota * pct) / 100), asOf, 'telemetry');
}

function minVersionFor(platforms) {
  if (platforms.length === 0) return null;
  if (platforms.includes('windows') && platforms.includes('macos')) return '1.7.9';
  if (platforms.includes('windows')) return '1.8.0';
  return '1.8.1';
}

function appVersionFor(platform, minVersion) {
  if (platform === 'windows') return minVersion === '1.7.9' ? '1.7.9' : '1.8.0';
  return minVersion === '1.8.1' ? '1.8.1' : '1.8.2';
}

function osVersionFor(platform, index) {
  if (platform === 'windows') return index % 2 === 0 ? 'Windows 11 23H2' : 'Windows 10 22H2';
  return index % 2 === 0 ? 'macOS 15.6.1' : 'macOS 14.7';
}

function lastFailureFor(id, server, rng) {
  if (!HAS_FAILURE.has(id)) return null;
  const stage = id === 'u-04' ? 'tls' : pick(rng, STAGES);
  const code = id === 'u-04' ? 'TLS_HANDSHAKE_TIMEOUT' : pick(rng, FAIL_CODES);
  const at = id === 'u-04' ? CLOCK - 180 : CLOCK - randInt(rng, 400, 20_000);
  return { at, node: server ?? pick(rng, FEATURED_NODES), stage, code };
}

function connectedFor(id, verdict, rng) {
  if (quiet(verdict)) return measured(false, null, 'telemetry');
  if (verdict === 'ok') return measured(true, CLOCK - randInt(rng, 20, 240), 'telemetry');
  if (id === 'u-04') return measured(false, CLOCK - 180, 'telemetry');
  const age = verdict === 'offline' ? randInt(rng, 3600, 80_000) : randInt(rng, 90, 1800);
  return measured(false, CLOCK - age, 'telemetry');
}

function lastSeenFor(id, verdict, connected) {
  // 上报过的那位有最后一次上报的时间；其余从来没说过话。
  if (STAGE_20[id]?.stage === 'reported') return CLOCK - STAGE_20[id].days * DAY;
  if (quiet(verdict)) return null;
  if (id === 'u-04') return CLOCK - 180;
  return connected.asOfSec;
}

function evidence(label, value, asOfSec, source = 'collector') {
  return { label, value, asOfSec, source };
}

function connectionEvent(partial) {
  return {
    id: partial.id,
    atMs: partial.atMs,
    receivedAt: partial.receivedAt,
    source: partial.source,
    userId: partial.userId,
    deviceId: partial.deviceId,
    platform: partial.platform,
    appVersion: partial.appVersion,
    osVersion: partial.osVersion,
    kind: partial.kind,
    node: partial.node,
    stage: partial.stage,
    outcome: partial.outcome,
    code: partial.code,
    error: partial.error,
    elapsedMs: partial.elapsedMs,
    delayMs: partial.delayMs,
    tcpDelayMs: partial.tcpDelayMs,
    exitDelayMs: partial.exitDelayMs,
    catalogRevision: partial.catalogRevision,
    edgeAsn: partial.edgeAsn,
    edgeAsOrg: partial.edgeAsOrg,
    edgeCountry: partial.edgeCountry,
    edgeRegion: partial.edgeRegion,
    edgeViaExit: partial.edgeViaExit,
  };
}

function edgeFor(rng) {
  const carrier = pick(rng, CARRIERS);
  return {
    edgeAsn: carrier.asn,
    edgeAsOrg: carrier.org,
    edgeCountry: 'CN',
    edgeRegion: pick(rng, carrier.regions),
  };
}

function timingsOk(rng) {
  const elapsedMs = randInt(rng, 80, 240);
  const tcpDelayMs = randInt(rng, 18, 70);
  const exitDelayMs = randInt(rng, 40, 140);
  return {
    elapsedMs,
    delayMs: elapsedMs,
    tcpDelayMs,
    exitDelayMs,
    stage: null,
    code: null,
    error: null,
    outcome: 'ok',
    edgeViaExit: rng() < 0.35,
  };
}

function timingsFail(rng, stage) {
  const elapsedMs = randInt(rng, 1800, 12_000);
  const tcpDelayMs = stage === 'dial' ? randInt(rng, 40, 400) : randInt(rng, 80, 600);
  return {
    elapsedMs,
    delayMs: elapsedMs,
    tcpDelayMs,
    exitDelayMs: null,
    stage,
    code: stage === 'dial'
      ? pick(rng, ['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'DNS_FAIL'])
      : pick(rng, ['TLS_HANDSHAKE_TIMEOUT', 'REALITY_AUTH_FAIL']),
    error: pick(rng, FAIL_ERRORS),
    outcome: 'fail',
    edgeViaExit: false,
  };
}

function stampMs(atMs, rng) {
  return { atMs, receivedAt: atMs + randInt(rng, 40, 1600) };
}

function buildU04Connections(userIdValue, devices, rng) {
  const device = devices[0];
  const events = [];
  const historicalNodes = ['Tokyo · Fuji', '香港 · 中环'];
  let seq = 0;

  function push(atMs, fields) {
    seq += 1;
    const edge = edgeFor(rng);
    events.push(connectionEvent({
      id: `ce-u04-${String(seq).padStart(3, '0')}`,
      ...stampMs(atMs, rng),
      userId: userIdValue,
      deviceId: device.id,
      platform: device.platform,
      appVersion: device.appVersion,
      osVersion: device.osVersion,
      catalogRevision: 40 + (seq % 3),
      ...edge,
      ...fields,
    }));
  }

  const historicalStart = (CLOCK - 7 * DAY) * 1000;
  const historicalEnd = (CLOCK - 2 * DAY) * 1000;
  const span = historicalEnd - historicalStart;
  let lastNode = historicalNodes[0];
  let switches = 0;
  for (let i = 0; i < 40; i += 1) {
    const atMs = historicalStart + Math.floor((span * (i + 1)) / 41);
    if (i === 6 || i === 14 || i === 22 || i === 31) {
      lastNode = lastNode === historicalNodes[0] ? historicalNodes[1] : historicalNodes[0];
      switches += 1;
      push(atMs - 8_000, {
        source: 'window',
        kind: 'nodeSwitch',
        node: lastNode,
        stage: null,
        outcome: 'switch',
        code: null,
        error: null,
        elapsedMs: null,
        delayMs: null,
        tcpDelayMs: null,
        exitDelayMs: null,
        edgeViaExit: false,
      });
    }
    push(atMs, {
      source: i % 3 === 0 ? 'direct' : 'window',
      kind: 'connectOk',
      node: lastNode,
      ...timingsOk(rng),
    });
  }

  const failStart = (CLOCK - 2 * DAY) * 1000 + 3_600_000;
  const failBeforeSuccess = [];
  for (let i = 0; i < 22; i += 1) {
    failBeforeSuccess.push(failStart + i * 3_700_000);
  }

  push(failBeforeSuccess[0] - 12_000, {
    source: 'window',
    kind: 'nodeSwitch',
    node: 'Los Angeles · Mesa',
    stage: null,
    outcome: 'switch',
    code: null,
    error: null,
    elapsedMs: null,
    delayMs: null,
    tcpDelayMs: null,
    exitDelayMs: null,
    edgeViaExit: false,
  });
  switches += 1;

  const failStages = ['dial', 'handshake', 'tls'];
  failBeforeSuccess.forEach((atMs, i) => {
    push(atMs, {
      source: 'failure',
      kind: 'connectFail',
      node: 'Los Angeles · Mesa',
      ...timingsFail(rng, failStages[i % 3]),
    });
  });

  const tokyoOkAt = (CLOCK * 1000) - 360_000;
  push(tokyoOkAt - 20_000, {
    source: 'window',
    kind: 'nodeSwitch',
    node: 'Tokyo · Fuji',
    stage: null,
    outcome: 'switch',
    code: null,
    error: null,
    elapsedMs: null,
    delayMs: null,
    tcpDelayMs: null,
    exitDelayMs: null,
    edgeViaExit: false,
  });
  switches += 1;
  push(tokyoOkAt, {
    source: 'direct',
    kind: 'connectOk',
    node: 'Tokyo · Fuji',
    ...timingsOk(rng),
    elapsedMs: 96,
    delayMs: 96,
    tcpDelayMs: 28,
    exitDelayMs: 64,
    edgeViaExit: true,
  });

  push((CLOCK * 1000) - 210_000, {
    source: 'window',
    kind: 'nodeSwitch',
    node: 'Los Angeles · Mesa',
    stage: null,
    outcome: 'switch',
    code: null,
    error: null,
    elapsedMs: null,
    delayMs: null,
    tcpDelayMs: null,
    exitDelayMs: null,
    edgeViaExit: false,
  });
  switches += 1;
  push((CLOCK * 1000) - 180_000, {
    source: 'failure',
    kind: 'connectFail',
    node: 'Los Angeles · Mesa',
    ...timingsFail(rng, 'handshake'),
    code: 'TLS_HANDSHAKE_TIMEOUT',
    stage: 'tls',
  });
  push((CLOCK * 1000) - 90_000, {
    source: 'failure',
    kind: 'connectFail',
    node: 'Los Angeles · Mesa',
    ...timingsFail(rng, 'dial'),
    code: 'ECONNREFUSED',
    stage: 'dial',
  });

  if (switches < 4) throw new Error(`u-04 nodeSwitch count ${switches}`);
  events.sort((a, b) => b.atMs - a.atMs);
  if (events.length < 60 || events.length > 80) throw new Error(`u-04 connections ${events.length}`);
  events.forEach((row, i) => {
    row.id = `ce-u04-${String(i + 1).padStart(3, '0')}`;
  });
  return events;
}

function buildGenericConnections(spec, devices, rng) {
  const { id, verdict, selectedServer } = spec;
  if (quiet(verdict)) return [];
  const count = randInt(rng, 12, 25);
  const device = devices[0] ?? null;
  const events = [];
  const spanMs = 5 * DAY * 1000;
  const newest = (CLOCK - (verdict === 'ok' ? 30 : 300)) * 1000;
  let node = selectedServer ?? pick(rng, FEATURED_NODES);
  for (let i = 0; i < count; i += 1) {
    const atMs = newest - Math.floor((spanMs * i) / count) - i * 17_000;
    const edge = edgeFor(rng);
    const wantSwitch = i > 0 && i % 7 === 0;
    const wantFail = verdict === 'unreachable' || (verdict === 'unstable' && i % 3 === 0)
      || (verdict === 'offline' && i < 2);
    let kind = 'connectOk';
    let fields;
    if (wantSwitch) {
      node = pick(rng, FEATURED_NODES);
      kind = 'nodeSwitch';
      fields = {
        stage: null,
        outcome: 'switch',
        code: null,
        error: null,
        elapsedMs: null,
        delayMs: null,
        tcpDelayMs: null,
        exitDelayMs: null,
        edgeViaExit: false,
        source: 'window',
      };
    } else if (wantFail) {
      kind = 'connectFail';
      fields = { ...timingsFail(rng, pick(rng, ['dial', 'handshake', 'tls'])), source: 'failure' };
    } else {
      fields = { ...timingsOk(rng), source: i % 2 === 0 ? 'window' : 'direct' };
    }
    events.push(connectionEvent({
      id: `ce-${id}-${String(i + 1).padStart(3, '0')}`,
      ...stampMs(atMs, rng),
      userId: id,
      deviceId: device ? device.id : null,
      platform: device ? device.platform : pick(rng, spec.platforms),
      appVersion: device ? device.appVersion : spec.minAppVersion,
      osVersion: device ? device.osVersion : null,
      kind,
      node,
      catalogRevision: 38 + (i % 4),
      ...edge,
      ...fields,
    }));
  }
  events.sort((a, b) => b.atMs - a.atMs);
  return events;
}

function buildActivity(spec, rng) {
  const rows = [];
  const unreported = quiet(spec.verdict);
  const outageUser = spec.id === 'u-04';
  for (let n = 167; n >= 0; n -= 1) {
    const hourAt = HOUR_FLOOR - n * HOUR;
    const hod = hourOfDay(hourAt);
    const recent = n < 20;
    if (unreported) {
      // 上报过的那位客户端确实在线过，只是一次也没连上：在线有分钟数，
      // 已连接一格都不该有，热力条上就是浅的一片。
      const online = spec.stage === 'reported' && n < 60 && hod >= 9
        ? randInt(rng, 6, 40)
        : 0;
      rows.push({
        hourAt,
        onlineMinutes: online,
        connectedMinutes: 0,
        bytesUp: 0,
        bytesDown: 0,
        node: null,
        platform: online > 0 ? 'macos' : null,
        appVersion: null,
      });
      continue;
    }
    const busy = hod >= 9 || hod < 1;
    let onlineMinutes;
    let connectedMinutes;
    if (outageUser && recent) {
      onlineMinutes = busy ? randInt(rng, 48, 60) : randInt(rng, 8, 28);
      connectedMinutes = randInt(rng, 0, 3);
    } else if (!busy) {
      if (rng() < 0.55) {
        onlineMinutes = 0;
        connectedMinutes = 0;
      } else {
        onlineMinutes = randInt(rng, 4, 22);
        connectedMinutes = randInt(rng, 0, onlineMinutes);
      }
    } else {
      onlineMinutes = randInt(rng, 38, 60);
      connectedMinutes = Math.min(onlineMinutes, randInt(rng, 28, 60));
    }
    const silent = connectedMinutes === 0;
    const bytesUp = silent ? 0 : randInt(rng, 40_000, 2_400_000);
    const bytesDown = silent ? 0 : randInt(rng, 200_000, 18_000_000);
    rows.push({
      hourAt,
      onlineMinutes,
      connectedMinutes,
      bytesUp,
      bytesDown,
      node: connectedMinutes > 0 ? spec.selectedServer ?? pick(rng, FEATURED_NODES) : null,
      platform: spec.platforms[0] ?? null,
      appVersion: spec.minAppVersion,
    });
  }
  return rows;
}

function buildDestinations(spec, rng, exactCount) {
  // 一次都没连上过的人没有流量，所以没有去向可看。
  if (spec.stage !== 'connected') return [];
  if (spec.verdict === 'unreported' && spec.id !== 'u-04') {
    const count = exactCount ?? randInt(rng, 8, 14);
    const pool = CLOUD_DESTINATIONS.concat(EXTRA_DESTINATIONS);
    const picked = pickN(rng, pool, count);
    const rows = picked.map((etld1, i) => ({
      dayAt: HOUR_FLOOR - (i % 3) * DAY,
      etld1,
      route: 'cloud',
      node: spec.selectedServer,
      connections: randInt(rng, 1, 20),
      bytesUp: randInt(rng, 10_000, 400_000),
      bytesDown: randInt(rng, 50_000, 8_000_000),
      topProcesses: pickN(rng, PROCESSES, randInt(rng, 1, 3)),
    }));
    rows.sort((a, b) => b.bytesDown - a.bytesDown);
    return rows;
  }
  if (spec.id === 'u-04') {
    const rows = [];
    const groups = [
      [CLOUD_DESTINATIONS, 'cloud'],
      [RESIDENTIAL_DESTINATIONS, 'residential'],
      [DIRECT_DESTINATIONS, 'direct'],
      [REJECT_DESTINATIONS, 'reject'],
    ];
    let rank = CLOUD_DESTINATIONS.length + 8;
    for (const [hosts, route] of groups) {
      for (const etld1 of hosts) {
        rank -= 1;
        const bytesDown = (rank + 1) * 9_000_000 + randInt(rng, 0, 800_000);
        rows.push({
          dayAt: HOUR_FLOOR - (rows.length % 3) * DAY,
          etld1,
          route,
          node: route === 'direct' || route === 'reject' ? null : (etld1 === 'claude.ai' ? 'Tokyo · Fuji' : spec.selectedServer),
          connections: randInt(rng, 4, 80),
          bytesUp: Math.floor(bytesDown / randInt(rng, 6, 14)),
          bytesDown,
          topProcesses: pickN(rng, PROCESSES, randInt(rng, 1, 3)),
        });
      }
    }
    rows.sort((a, b) => b.bytesDown - a.bytesDown);
    if (rows.length !== 30) throw new Error(`u-04 destinations ${rows.length}`);
    return rows;
  }
  const count = exactCount ?? randInt(rng, 8, 30);
  const pool = CLOUD_DESTINATIONS.concat(EXTRA_DESTINATIONS);
  const hosts = pickN(rng, pool, count);
  const routes = ['cloud', 'cloud', 'cloud', 'residential', 'direct'];
  const rows = hosts.map((etld1, i) => {
    const route = i === hosts.length - 1 && count > 10 ? 'reject' : pick(rng, routes);
    const bytesDown = randInt(rng, 80_000, 40_000_000);
    return {
      dayAt: HOUR_FLOOR - (i % 3) * DAY,
      etld1,
      route,
      node: route === 'direct' || route === 'reject' ? null : spec.selectedServer,
      connections: randInt(rng, 1, 60),
      bytesUp: Math.floor(bytesDown / randInt(rng, 5, 16)),
      bytesDown,
      topProcesses: pickN(rng, PROCESSES, randInt(rng, 1, 3)),
    };
  });
  rows.sort((a, b) => b.bytesDown - a.bytesDown);
  return rows;
}

function buildServices(spec, rng, exactRange) {
  if (spec.stage !== 'connected') return [];
  const familiesNeeded = spec.id === 'u-04' ? SERVICE_FAMILIES.slice() : pickN(rng, SERVICE_FAMILIES, randInt(rng, 3, 6));
  const count = spec.id === 'u-04'
    ? Math.max(12, familiesNeeded.length * 2)
    : (exactRange ? randInt(rng, exactRange[0], exactRange[1]) : randInt(rng, 4, 12));
  const routes = spec.id === 'u-04' ? ['cloud', 'residential'] : ['cloud', 'cloud', 'residential'];
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const family = familiesNeeded[i % familiesNeeded.length];
    const route = routes[i % routes.length];
    const dayAt = HOUR_FLOOR - (i % 3) * DAY;
    rows.push({
      dayAt,
      family,
      route,
      bytes: randInt(rng, 50_000, 80_000_000),
      sessions: randInt(rng, 1, 40),
      lastSeenAt: CLOCK - randInt(rng, 120, 2 * DAY),
    });
  }
  return rows;
}

/**
 * 一台装了但还没连上的客户端。
 *
 * 装了还没上报的那位连版本都没有——版本是跟着上报走的——所以这两栏是空的，
 * 页面上就该显示"—"。上报过的那位有最后一次上报的时间，但从来没连上，
 * 所以 connected 是 false，也没有失败记录可写。
 */
function quietDevice(spec) {
  const reported = spec.stage === 'reported';
  return {
    id: `dev-${spec.id}-01`,
    name: reported ? 'MacBook Air' : 'MacBook Pro',
    platform: 'macos',
    appVersion: null,
    osVersion: reported ? 'macOS 15.6.1' : null,
    status: 'active',
    selectedServer: null,
    lastSeenAt: reported ? spec.stageSinceAt : null,
    createdAt: spec.stageSinceAt,
    connected: false,
    lastFailAt: null,
    lastFailCode: null,
    lastFailNode: null,
  };
}

function buildDevices(spec, rng) {
  if (spec.stage === 'device_added' || spec.stage === 'reported') return [quietDevice(spec)];
  if (quiet(spec.verdict)) return [];
  if (spec.id === 'u-04') {
    return [
      {
        id: 'dev-u04-mbp',
        name: 'MacBook Pro',
        platform: 'macos',
        appVersion: '1.8.2',
        osVersion: 'macOS 15.6.1',
        status: 'active',
        selectedServer: 'Los Angeles · Mesa',
        lastSeenAt: CLOCK - 180,
        createdAt: CLOCK - 90 * DAY,
        connected: true,
        lastFailAt: null,
        lastFailCode: null,
        lastFailNode: null,
      },
      {
        id: 'dev-u04-air',
        name: '办公室的 Air',
        platform: 'macos',
        appVersion: '1.8.0',
        osVersion: 'macOS 14.7',
        status: 'idle',
        selectedServer: 'Tokyo · Fuji',
        lastSeenAt: CLOCK - 2 * DAY,
        createdAt: CLOCK - 200 * DAY,
        connected: false,
        lastFailAt: null,
        lastFailCode: null,
        lastFailNode: null,
      },
      {
        id: 'dev-u04-win',
        name: 'DESKTOP-TAO',
        platform: 'windows',
        appVersion: '1.7.9',
        osVersion: 'Windows 11 23H2',
        status: 'idle',
        selectedServer: '香港 · 中环',
        lastSeenAt: CLOCK - 5 * DAY,
        createdAt: CLOCK - 120 * DAY,
        connected: false,
        lastFailAt: CLOCK - 5 * DAY,
        lastFailCode: 'ETIMEDOUT',
        lastFailNode: '香港 · 中环',
      },
    ];
  }
  const devices = [];
  const plats = spec.platforms.length ? spec.platforms : ['macos'];
  const names = {
    macos: ['MacBook Pro', 'Mac mini', '家里的 Mac'],
    windows: ['DESKTOP-HOME', 'ThinkPad', '办公电脑'],
  };
  plats.forEach((platform, i) => {
    devices.push({
      id: `dev-${spec.id}-${platform.slice(0, 3)}-${i + 1}`,
      name: names[platform][i % names[platform].length],
      platform,
      appVersion: appVersionFor(platform, spec.minAppVersion),
      osVersion: osVersionFor(platform, spec.index + i),
      status: spec.verdict === 'ok' && i === 0 ? 'active' : 'idle',
      selectedServer: spec.selectedServer,
      lastSeenAt: spec.lastSeenAt,
      createdAt: CLOCK - (60 + spec.index * 3 + i * 10) * DAY,
      connected: spec.verdict === 'ok' && i === 0,
      lastFailAt: i === 0 && spec.lastFailure ? spec.lastFailure.at : null,
      lastFailCode: i === 0 && spec.lastFailure ? spec.lastFailure.code : null,
      lastFailNode: i === 0 && spec.lastFailure ? spec.lastFailure.node : null,
    });
  });
  if (plats.length === 1 && rng() < 0.35) {
    const platform = plats[0];
    devices.push({
      id: `dev-${spec.id}-${platform.slice(0, 3)}-2`,
      name: names[platform][1],
      platform,
      appVersion: appVersionFor(platform, spec.minAppVersion),
      osVersion: osVersionFor(platform, spec.index + 3),
      status: 'idle',
      selectedServer: spec.selectedServer,
      lastSeenAt: spec.lastSeenAt === null ? null : spec.lastSeenAt - DAY,
      createdAt: CLOCK - (90 + spec.index) * DAY,
      connected: false,
      lastFailAt: null,
      lastFailCode: null,
      lastFailNode: null,
    });
  }
  return devices;
}

function buildChores(spec) {
  if (spec.id === 'u-04') {
    return [
      {
        id: 'chore-u04-renew',
        kind: 'renew',
        summary: '套餐将在 20 天后到期',
        dueAt: CLOCK + 20 * DAY,
        createdAt: CLOCK - 3 * DAY,
      },
      {
        id: 'chore-u04-quota',
        kind: 'quota',
        summary: '本月已用过半，留意配额',
        dueAt: null,
        createdAt: CLOCK - 5 * DAY,
      },
      {
        id: 'chore-u04-version',
        kind: 'version',
        summary: 'DESKTOP-TAO 还在 1.7.9，低于当前最低支持版本',
        dueAt: null,
        createdAt: CLOCK - 2 * DAY,
      },
    ];
  }
  if (quiet(spec.verdict)) return [];
  const chores = [];
  if (spec.expiresAt !== null && spec.expiresAt - CLOCK < 10 * DAY && spec.expiresAt > CLOCK) {
    chores.push({
      id: `chore-${spec.id}-renew`,
      kind: 'renew',
      summary: '套餐将在 10 天内到期',
      dueAt: spec.expiresAt,
      createdAt: CLOCK - 2 * DAY,
    });
  }
  return chores;
}

function buildNow(spec, devices) {
  const device = devices[0] ?? null;
  if (spec.id === 'u-04') {
    return {
      connected: spec.connected,
      node: null,
      connectedSince: null,
      deviceId: 'dev-u04-mbp',
      platform: 'macos',
      appVersion: '1.8.2',
      osVersion: 'macOS 15.6.1',
      carrier: '中国移动',
      asn: 9808,
      region: '江苏',
    };
  }
  const connectedNow = spec.verdict === 'ok';
  return {
    connected: spec.connected,
    node: connectedNow ? spec.selectedServer : null,
    connectedSince: connectedNow ? CLOCK - 3 * HOUR : null,
    deviceId: device ? device.id : null,
    platform: device ? device.platform : (spec.platforms[0] ?? null),
    appVersion: device ? device.appVersion : spec.minAppVersion,
    osVersion: device ? device.osVersion : null,
    carrier: quiet(spec.verdict) ? null : '中国电信',
    asn: quiet(spec.verdict) ? null : 4134,
    region: quiet(spec.verdict) ? null : '上海',
  };
}

function buildBilling(spec) {
  if (spec.id === 'u-04') {
    return {
      plan: '标准',
      deviceLimit: 5,
      quotaBytes: spec.quotaBytes,
      usageBytes: spec.usageBytes,
      expiresAt: CLOCK + 20 * DAY,
      firstEntitledAt: CLOCK - 180 * DAY,
      createdAt: CLOCK - 200 * DAY,
    };
  }
  return {
    plan: quiet(spec.verdict) ? null : (spec.index % 5 === 0 ? '高级' : '标准'),
    deviceLimit: spec.index % 4 === 0 ? 3 : 5,
    quotaBytes: spec.quotaBytes,
    usageBytes: spec.usageBytes,
    expiresAt: spec.expiresAt,
    firstEntitledAt: quiet(spec.verdict) ? null : CLOCK - (100 + spec.index) * DAY,
    createdAt: CLOCK - (120 + spec.index) * DAY,
  };
}

function buildCustomer(index, overrides = {}) {
  const id = overrides.id ?? userId(index);
  const rng = rngFor(0x4F5043 ^ Math.imul(index, 2654435761));
  const verdict = overrides.verdict ?? VERDICT_20[id];
  if (!verdict) throw new Error(`missing verdict for ${id}`);
  const { health, tone } = HEALTH_BY_VERDICT[verdict];
  const stage = overrides.stage ?? stageOf(id, verdict);
  /**
   * 卡在这一步多久了，以及第一次连上是什么时候。
   *
   * 连上过的人这两个数是同一个：漏斗到"连上过"就不再走了，所以停在这一步的
   * 时间就是第一次连上的时间。没连上过的人第一次连上是空的——这一栏是事实，
   * 不是还没测出来。
   */
  const firstConnectedAt = stage === 'connected' ? CLOCK - (95 + index) * DAY : null;
  const stageSinceAt = overrides.stageSinceAt
    ?? (stage === 'connected' ? firstConnectedAt : CLOCK - (STAGE_20[id]?.days ?? 4) * DAY);
  const platforms = overrides.platforms ?? platformsFor(id, index);
  const selectedServer = Object.prototype.hasOwnProperty.call(overrides, 'selectedServer')
    ? overrides.selectedServer
    : (quiet(verdict) ? null : (SERVER_20[id] ?? pick(rng, FEATURED_NODES)));
  const minAppVersion = Object.prototype.hasOwnProperty.call(overrides, 'minAppVersion')
    ? overrides.minAppVersion
    // 版本跟着上报走，一次都没上报过就没有版本可写。
    : (stage === 'connected' ? minVersionFor(platforms) : null);
  const quotaBytes = Object.prototype.hasOwnProperty.call(overrides, 'quotaBytes')
    ? overrides.quotaBytes
    : quotaFor(id);
  const usageBytes = overrides.usageBytes ?? usageFor(id, quotaBytes, rng);
  const connected = overrides.connected ?? connectedFor(id, verdict, rng);
  const lastSeenAt = Object.prototype.hasOwnProperty.call(overrides, 'lastSeenAt')
    ? overrides.lastSeenAt
    : lastSeenFor(id, verdict, connected);
  const expiresAt = Object.prototype.hasOwnProperty.call(overrides, 'expiresAt')
    ? overrides.expiresAt
    : expiresAtFor(id, index);
  const spec = {
    id,
    index,
    email: overrides.email ?? EMAILS_20[index - 1],
    verdict,
    stage,
    stageSinceAt,
    firstConnectedAt,
    health,
    tone,
    reason: Object.prototype.hasOwnProperty.call(overrides, 'reason')
      ? overrides.reason
      : (verdict === 'ok' ? null : (REASON_20[id] ?? '近几小时没有稳定连上')),
    lifecycle: overrides.lifecycle ?? lifecycleFor(id),
    platforms,
    selectedServer,
    connected,
    lastFailure: Object.prototype.hasOwnProperty.call(overrides, 'lastFailure')
      ? overrides.lastFailure
      : lastFailureFor(id, selectedServer, rng),
    usageBytes,
    quotaBytes,
    services: overrides.services ?? servicesFor(id, index, rng),
    minAppVersion,
    expiresAt,
    lastSeenAt,
    updatedAt: CLOCK - (index % 11) * 30,
  };

  const devices = buildDevices(spec, rng);
  spec.deviceCount = devices.length;
  const chores = buildChores(spec);
  const now = buildNow(spec, devices);
  const billing = buildBilling(spec);
  const connections = spec.id === 'u-04'
    ? buildU04Connections(spec.id, devices, rngFor(0x553404 ^ Math.imul(index, 747796405)))
    : buildGenericConnections(spec, devices, rngFor(0x434F4E ^ Math.imul(index, 1597334677)));
  const activity = buildActivity(spec, rngFor(0x414354 ^ Math.imul(index, 2246822519)));
  const destinations = buildDestinations(
    spec,
    rngFor(0x445354 ^ Math.imul(index, 3266489917)),
    overrides.destinationCount,
  );
  const services = buildServices(spec, rngFor(0x535643 ^ Math.imul(index, 668265263)), overrides.serviceRange);

  const summary = {
    userId: spec.id,
    email: spec.email,
    wechatId: wechatFor(index, spec.email),
    verdict: spec.verdict,
    health: spec.health,
    tone: spec.tone,
    reason: spec.reason,
    lifecycle: spec.lifecycle,
    deviceCount: spec.deviceCount,
    platforms: spec.platforms,
    selectedServer: spec.selectedServer,
    connected: spec.connected,
    lastFailure: spec.lastFailure,
    usageBytes: spec.usageBytes,
    quotaBytes: spec.quotaBytes,
    services: spec.services,
    minAppVersion: spec.minAppVersion,
    stage: spec.stage,
    stageSinceAt: spec.stageSinceAt,
    firstConnectedAt: spec.firstConnectedAt,
    expiresAt: spec.expiresAt,
    lastSeenAt: spec.lastSeenAt,
    updatedAt: spec.updatedAt,
  };

  const detail = {
    userId: spec.id,
    email: spec.email,
    wechatId: wechatFor(index, spec.email),
    contact: contactFor(index),
    notes: notesFor(index),
    verdict: spec.verdict,
    health: spec.health,
    tone: spec.tone,
    reason: spec.reason,
    lifecycle: spec.lifecycle,
    stage: spec.stage,
    stageSinceAt: spec.stageSinceAt,
    firstConnectedAt: spec.firstConnectedAt,
    now,
    devices,
    chores,
    billing,
    updatedAt: spec.updatedAt,
  };

  return {
    summary,
    detail: {
      detail,
      connections: listOf(connections),
      activity: listOf(activity),
      destinations: listOf(destinations),
      services: listOf(services),
    },
  };
}

function denseEmail(n) {
  return `regional.operations.observer.desk-${String(n).padStart(2, '0')}.east-china-backbone.very-long-name@example.com`;
}

function denseVerdict(n) {
  // 压版式里也要有还没用起来的人，不然那个词只在二十位的那一份里出现过一次。
  if (n % 9 === 0) return 'never_used';
  const cycle = ['ok', 'offline', 'unstable', 'unreported', 'unreachable'];
  return cycle[(n - 21) % cycle.length];
}

/** 压版式里没用起来的那几位，一人卡在一步，轮着来。 */
function denseStage(n) {
  return ['registered', 'device_added', 'reported'][Math.floor(n / 9) % 3];
}

function denseReason(verdict) {
  if (verdict === 'ok') return null;
  if (verdict === 'never_used') return '开通之后一次也没有连上过';
  if (verdict === 'unreachable') return '最近一次拨号连续失败，之后没有成功';
  if (verdict === 'unstable') return '一天内多次切换节点，连接质量不稳';
  if (verdict === 'unreported') return '超过两天没有客户端上报';
  return '已经连续几个小时离线';
}

function buildCustomers(count) {
  const items = [];
  const details = {};
  for (let n = 1; n <= count; n += 1) {
    let row;
    if (n <= 20) {
      row = buildCustomer(n);
    } else {
      const verdict = denseVerdict(n);
      const rng = rngFor(0x44454E ^ Math.imul(n, 1013904223));
      const never = verdict === 'never_used';
      const stage = never ? denseStage(n) : 'connected';
      const platforms = quiet(verdict)
        ? (stage === 'registered' ? [] : ['macos'])
        : (n % 3 === 0 ? ['macos', 'windows'] : n % 3 === 1 ? ['macos'] : ['windows']);
      row = buildCustomer(n, {
        email: denseEmail(n),
        verdict,
        stage,
        stageSinceAt: never ? CLOCK - (3 + (n % 6)) * DAY : undefined,
        reason: denseReason(verdict),
        lifecycle: n % 17 === 0 ? 'expired' : n % 13 === 0 ? 'suspended' : 'active',
        platforms,
        selectedServer: quiet(verdict) ? null : LONG_NODES[(n - 21) % LONG_NODES.length],
        minAppVersion: quiet(verdict) ? null : minVersionFor(platforms),
        quotaBytes: n % 11 === 0 ? null : (120 + (n % 9) * 10) * GiB,
        lastFailure: verdict === 'unreachable' || verdict === 'unstable'
          ? {
              at: CLOCK - randInt(rng, 200, 8000),
              node: LONG_NODES[(n - 21) % LONG_NODES.length],
              stage: pick(rng, STAGES),
              code: pick(rng, FAIL_CODES),
            }
          : null,
        destinationCount: randInt(rng, 8, 16),
        serviceRange: [4, 8],
      });
    }
    items.push(row.summary);
    details[row.summary.userId] = row.detail;
  }
  return {
    clock: CLOCK,
    list: listOf(items),
    details,
  };
}

function jobParamsFor(type, subjectId) {
  if (type === 'node_probe') return { node: subjectId ?? 'Los Angeles · Mesa', timeoutSec: 45 };
  if (type === 'xray_dial_errors') return { node: subjectId ?? 'Los Angeles · Mesa', limit: 50 };
  if (type === 'identity_sync') return { userId: subjectId ?? 'u-04', force: false };
  if (type === 'home_line_probe') return { line: subjectId ?? 'home-1', carriers: ['mobile', 'unicom'] };
  if (type === 'collect_quality') return { node: subjectId ?? 'Tokyo · Fuji' };
  return { subject: subjectId ?? 'fleet', dryRun: false };
}

function buildJob(incident, index, rng) {
  const type = incident.subjectType === 'user'
    ? 'identity_sync'
    : incident.subjectType === 'home_exit'
      ? 'home_line_probe'
      : incident.subjectType === 'fleet'
        ? 'collect_quality'
        : pick(rng, ['node_probe', 'xray_dial_errors', 'xray_restart']);
  const succeeded = incident.status === 'resolved' || rng() < 0.55;
  const status = succeeded ? 'succeeded' : (incident.status === 'open' ? pick(rng, ['queued', 'leased', 'succeeded']) : 'succeeded');
  const createdAt = incident.openedAt + 30 + index * 40;
  const finishedAt = status === 'succeeded' || status === 'failed' ? createdAt + 20 + index * 8 : null;
  return {
    id: `job-${incident.id}-${index + 1}`,
    type,
    executor: type === 'node_probe' || type === 'xray_restart' ? 'exit_agent' : (type === 'identity_sync' ? 'hub' : pick(rng, JOB_EXECUTORS)),
    status,
    subjectType: incident.subjectType,
    subjectId: incident.subjectId,
    params: jobParamsFor(type, incident.subjectId),
    attempts: status === 'queued' ? 0 : 1,
    maxAttempts: 3,
    idempotencyKey: `${incident.id}:${type}:${index + 1}`,
    requestedBy: index === 0 ? 'system' : 'ops.rui',
    incidentId: incident.id,
    notBefore: null,
    expiresAt: createdAt + DAY,
    leasedUntil: status === 'leased' ? createdAt + 120 : null,
    resultSummary: status === 'succeeded' ? '已完成' : (status === 'failed' ? '执行失败' : null),
    createdAt,
    updatedAt: finishedAt ?? createdAt,
    finishedAt,
  };
}

function buildDelivery(incident, index, status) {
  const at = incident.openedAt + 90 + index * 30;
  const sent = status === 'sent';
  return {
    id: `del-${incident.id}-${index + 1}`,
    ruleId: 'rule-telegram-ops',
    incidentId: incident.id,
    dedupeKey: `${incident.id}:open:${index + 1}`,
    transition: incident.status === 'resolved' && index > 0 ? 'resolve' : 'open',
    status,
    channel: 'webhook',
    target: 'https://hooks.example.com/telegram/ops',
    attempts: sent ? 1 : 1,
    error: status === 'suppressed' ? 'cooldown 未到' : (status === 'failed' ? 'webhook 超时' : null),
    at,
    deliveredAt: sent ? at + 2 : null,
  };
}

function buildEvents(incident, rng) {
  const events = [];
  const push = (type, at, note, actor = 'system') => {
    events.push({
      id: `iev-${incident.id}-${String(events.length + 1).padStart(2, '0')}`,
      incidentId: incident.id,
      at,
      type,
      actor,
      note,
    });
  };
  push('opened', incident.openedAt, incident.title);
  if (incident.severity === 'severe') {
    push('escalated', incident.openedAt + 400, '影响面扩大，升为严重', 'system');
  } else {
    push('note', incident.openedAt + 280, '已对照探测记录', 'ops.rui');
  }
  if (incident.ackedAt !== null) {
    push('acked', incident.ackedAt, '已接手处理', 'ops.rui');
  }
  push('job', incident.openedAt + 600, '已下发探测任务', 'system');
  push('alert', incident.openedAt + 700, '已推送到值班群', 'system');
  if (incident.status === 'open' && rng() < 0.7) {
    push('note', incident.lastSeenAt - 60, '仍在观察，没有新的成功连接', 'ops.rui');
  }
  if (incident.status === 'resolved') {
    if (events.length < 6) push('note', incident.resolvedAt - 400, '探测已恢复', 'ops.rui');
    push('resolved', incident.resolvedAt, '已恢复', 'system');
  }
  while (events.length < 4) {
    push('note', incident.openedAt + 800 + events.length, '补充观察记录', 'ops.rui');
  }
  if (events.length > 9) events.length = 9;
  events.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  events.forEach((row, i) => {
    row.id = `iev-${incident.id}-${String(i + 1).padStart(2, '0')}`;
  });
  return events;
}

function incidentDetail(incident, rng) {
  const jobCount = randInt(rng, 1, 3);
  const jobs = Array.from({ length: jobCount }, (_, i) => buildJob(incident, i, rng));
  const deliveries = incident.id === 'inc-node-la'
    ? [buildDelivery(incident, 0, 'sent'), buildDelivery(incident, 1, 'suppressed')]
    : [buildDelivery(incident, 0, pick(rng, ['sent', 'suppressed', 'sent']))];
  if (incident.id !== 'inc-node-la' && rng() < 0.4) {
    deliveries.push(buildDelivery(incident, deliveries.length, 'sent'));
  }
  return {
    incident,
    events: listOf(buildEvents(incident, rng)),
    jobs: listOf(jobs),
    deliveries: listOf(deliveries),
  };
}

function makeIncident(partial) {
  return {
    id: partial.id,
    dedupeKey: partial.dedupeKey,
    kind: partial.kind,
    subjectType: partial.subjectType,
    subjectId: partial.subjectId,
    severity: partial.severity,
    status: partial.status,
    tone: partial.tone,
    title: partial.title,
    summary: partial.summary,
    parentIncidentId: partial.parentIncidentId,
    rulesVersion: partial.rulesVersion,
    impactCount: partial.impactCount,
    evidence: partial.evidence,
    openedAt: partial.openedAt,
    lastSeenAt: partial.lastSeenAt,
    ackedAt: partial.ackedAt,
    snoozedUntil: partial.snoozedUntil,
    resolvedAt: partial.resolvedAt,
    nextCheckAt: partial.nextCheckAt ?? null,
    closure: partial.closure ?? null,
  };
}

function buildCoreIncidents() {
  const incNodeLa = makeIncident({
    id: 'inc-node-la',
    dedupeKey: 'node:Los Angeles · Mesa:node_blocked',
    kind: 'node_blocked',
    subjectType: 'node',
    subjectId: 'Los Angeles · Mesa',
    severity: 'severe',
    status: 'open',
    tone: 'sev',
    title: 'Los Angeles · Mesa 被墙，大陆三网都连不上',
    summary: '近两小时探测全部失败，已有 5 位客户受影响。',
    parentIncidentId: null,
    rulesVersion: 3,
    impactCount: 5,
    evidence: [
      evidence('blockStatus', '"LIKELY_BLOCKED"', CLOCK - 180, 'engine'),
      evidence('loss', '[{"key":"unicom","lossPct":10.4},{"key":"mobile","lossPct":12.1}]', CLOCK - 180, 'engine'),
      evidence('fails30m', '{"attempts":38,"failures":31,"distinctUsers":5,"handshakeDistinctUsers":4}', CLOCK - 180, 'engine'),
      evidence('machine', '{"cpu":4,"memRatio":0.12,"diskRatio":0.38,"load1":0.04}', CLOCK - 240, 'engine'),
      evidence('occupancy', '5', CLOCK - 180, 'engine'),
      evidence('海外探测', '正常', CLOCK - 240, 'collector'),
    ],
    openedAt: CLOCK - 7200,
    nextCheckAt: null,
    closure: null,
    lastSeenAt: CLOCK - 180,
    ackedAt: null,
    snoozedUntil: null,
    resolvedAt: null,
  });

  const incUser = makeIncident({
    id: 'inc-user-jiangsu',
    dedupeKey: 'user:u-04:customer_unreachable',
    kind: 'customer_unreachable',
    subjectType: 'user',
    subjectId: 'u-04',
    severity: 'warn',
    status: 'open',
    tone: 'warn',
    title: 'wang.tao 连不上，卡在 Los Angeles · Mesa',
    summary: '江苏移动上来后反复握手失败，最近一次成功还在东京。',
    parentIncidentId: 'inc-node-la',
    rulesVersion: 3,
    impactCount: 1,
    evidence: [
      evidence('最近失败', 'Los Angeles · Mesa · tls', CLOCK - 180, 'telemetry'),
      evidence('运营商', '中国移动 江苏', CLOCK - 180, 'engine'),
    ],
    openedAt: CLOCK - 5400,
    nextCheckAt: null,
    closure: null,
    lastSeenAt: CLOCK - 180,
    ackedAt: null,
    snoozedUntil: null,
    resolvedAt: null,
  });

  const resolvedSpecs = [
    {
      id: 'inc-r1',
      kind: 'node_degraded',
      subjectType: 'node',
      subjectId: 'Tokyo · Sakura',
      severity: 'warn',
      tone: 'warn',
      title: 'Tokyo · Sakura 劣化已恢复',
      summary: '晚高峰丢包升高，半小时后自行恢复。',
      resolvedAt: CLOCK - 26_000,
      openedAt: CLOCK - 26_000 - 5400,
      nextCheckAt: null,
      closure: null,
      ackedAt: CLOCK - 26_000 - 1800,
      impactCount: 2,
    },
    {
      id: 'inc-r2',
      kind: 'customer_unstable',
      subjectType: 'user',
      subjectId: 'u-02',
      severity: 'notice',
      tone: 'info',
      title: 'zhang.min 连接不稳已恢复',
      summary: '白天切过两次节点，晚上已稳定。',
      resolvedAt: CLOCK - DAY,
      openedAt: CLOCK - DAY - 7200,
      nextCheckAt: null,
      closure: null,
      ackedAt: null,
      impactCount: 1,
    },
    {
      id: 'inc-r3',
      kind: 'home_exit_down',
      subjectType: 'home_exit',
      subjectId: 'home-suzhou-01',
      severity: 'severe',
      tone: 'sev',
      title: '苏州家宽出口掉线后已回来',
      summary: '光猫重启后线路恢复，影响 3 位客户。',
      resolvedAt: CLOCK - 2 * DAY,
      openedAt: CLOCK - 2 * DAY - 3600,
      nextCheckAt: null,
      closure: null,
      ackedAt: CLOCK - 2 * DAY - 2800,
      impactCount: 3,
    },
    {
      id: 'inc-r4',
      kind: 'fleet_pressure',
      subjectType: 'fleet',
      subjectId: 'asia',
      severity: 'notice',
      tone: 'info',
      title: '亚太出口压力已回落',
      summary: '晚高峰占用偏高，过后恢复正常。',
      resolvedAt: CLOCK - 4 * DAY,
      openedAt: CLOCK - 4 * DAY - 10_800,
      nextCheckAt: null,
      closure: null,
      ackedAt: null,
      impactCount: 4,
    },
    {
      id: 'inc-r5',
      kind: 'node_blocked',
      subjectType: 'node',
      subjectId: 'Hong Kong · Victoria',
      severity: 'warn',
      tone: 'warn',
      title: 'Hong Kong · Victoria 短时被墙后已通',
      summary: '移动方向失败一轮，随后探测恢复。',
      resolvedAt: CLOCK - 6 * DAY,
      openedAt: CLOCK - 6 * DAY - 2400,
      nextCheckAt: null,
      closure: null,
      ackedAt: CLOCK - 6 * DAY - 1200,
      impactCount: 2,
    },
  ];

  const resolved = resolvedSpecs.map((spec) => makeIncident({
    id: spec.id,
    dedupeKey: `${spec.subjectType}:${spec.subjectId}:${spec.kind}`,
    kind: spec.kind,
    subjectType: spec.subjectType,
    subjectId: spec.subjectId,
    severity: spec.severity,
    status: 'resolved',
    tone: spec.tone,
    title: spec.title,
    summary: spec.summary,
    parentIncidentId: null,
    rulesVersion: 3,
    impactCount: spec.impactCount,
    evidence: [
      evidence('结束原因', '探测恢复', spec.resolvedAt, 'collector'),
      evidence('影响', String(spec.impactCount), spec.resolvedAt, 'telemetry'),
    ],
    openedAt: spec.openedAt,
    nextCheckAt: null,
    closure: null,
    lastSeenAt: spec.resolvedAt,
    ackedAt: spec.ackedAt,
    snoozedUntil: null,
    resolvedAt: spec.resolvedAt,
  }));

  const items = [incNodeLa, incUser, ...resolved];
  const details = {};
  items.forEach((incident, i) => {
    details[incident.id] = incidentDetail(incident, rngFor(0x494E43 ^ Math.imul(i + 1, 2246822519)));
  });
  return {
    clock: CLOCK,
    list: listOf(items),
    details,
  };
}

function buildDenseIncidents() {
  const items = [];
  const details = {};
  const kinds = ['node_blocked', 'node_degraded', 'customer_unreachable', 'home_exit_down', 'fleet_pressure'];
  const titlesOpen = [
    '出口连续失败，正在观察',
    '客户连不上，已挂到节点事故下',
    '家宽出口抖动，等待下一轮探测',
    '晚高峰占用偏高',
    '握手失败次数超过阈值',
  ];
  const titlesResolved = [
    '短时失败后已恢复',
    '客户已重新连上',
    '家宽出口已回来',
    '压力回落',
    '探测恢复正常',
  ];
  for (let n = 1; n <= 36; n += 1) {
    const id = `inc-d${String(n).padStart(2, '0')}`;
    const rng = rngFor(0x44494E ^ Math.imul(n, 1597334677));
    const open = n <= 24;
    const subjectType = SUBJECT_TYPES[(n - 1) % SUBJECT_TYPES.length];
    const severity = SEVERITIES[(n - 1) % SEVERITIES.length];
    const tone = severity === 'severe' ? 'sev' : severity === 'warn' ? 'warn' : 'info';
    const kind = kinds[(n - 1) % kinds.length];
    const subjectId = subjectType === 'user'
      ? userId(((n - 1) % 20) + 1)
      : subjectType === 'node'
        ? FEATURED_NODES[(n - 1) % FEATURED_NODES.length]
        : subjectType === 'home_exit'
          ? `home-line-${String((n % 4) + 1).padStart(2, '0')}`
          : 'asia';
    const resolvedAt = open ? null : CLOCK - (n - 24) * 7200 - 12_000;
    const openedAt = open ? CLOCK - n * 900 - 1800 : resolvedAt - randInt(rng, 1800, 14_000);
    const incident = makeIncident({
      id,
      dedupeKey: `${subjectType}:${subjectId}:${kind}:${id}`,
      kind,
      subjectType,
      subjectId,
      severity,
      status: open ? 'open' : 'resolved',
      tone,
      title: `${open ? titlesOpen[(n - 1) % titlesOpen.length] : titlesResolved[(n - 1) % titlesResolved.length]} · ${subjectId}`,
      summary: open ? '仍在观察，尚未恢复。' : '已经恢复，留作记录。',
      parentIncidentId: open && n % 6 === 0 ? 'inc-d01' : null,
      rulesVersion: 3,
      impactCount: randInt(rng, 1, 4),
      evidence: [
        evidence('探测', open ? '仍失败' : '已恢复', open ? CLOCK - 300 : resolvedAt, 'collector'),
        evidence('影响', String(1 + (n % 4)), open ? CLOCK - 300 : resolvedAt, 'telemetry'),
      ],
      openedAt,
      lastSeenAt: open ? CLOCK - randInt(rng, 60, 900) : resolvedAt,
      ackedAt: n % 3 === 0 ? openedAt + 400 : null,
      snoozedUntil: null,
      resolvedAt,
    });
    items.push(incident);
    details[id] = incidentDetail(incident, rng);
  }
  return {
    clock: CLOCK,
    list: listOf(items),
    details,
  };
}

function buildEmptyIncidents() {
  const specs = [
    {
      id: 'inc-e1',
      resolvedAt: CLOCK - 90_000,
      openedAt: CLOCK - 90_000 - 5400,
      nextCheckAt: null,
      closure: null,
      title: '东京出口短时失败后已恢复',
      summary: '半小时后探测恢复。',
      subjectType: 'node',
      subjectId: 'Tokyo · Fuji',
      kind: 'node_degraded',
    },
    {
      id: 'inc-e2',
      resolvedAt: CLOCK - 400_000,
      openedAt: CLOCK - 400_000 - 7200,
      nextCheckAt: null,
      closure: null,
      title: '新加坡出口被墙后已通',
      summary: '第二轮探测恢复，没有新的客户投诉。',
      subjectType: 'node',
      subjectId: 'Singapore · Harbour（新加坡海港 · 大陆直连 · CMIN2）',
      kind: 'node_blocked',
    },
  ];
  const items = specs.map((spec) => makeIncident({
    id: spec.id,
    dedupeKey: `${spec.subjectType}:${spec.subjectId}:${spec.kind}`,
    kind: spec.kind,
    subjectType: spec.subjectType,
    subjectId: spec.subjectId,
    severity: spec.id === 'inc-e2' ? 'severe' : 'warn',
    status: 'resolved',
    tone: spec.id === 'inc-e2' ? 'sev' : 'warn',
    title: spec.title,
    summary: spec.summary,
    parentIncidentId: null,
    rulesVersion: 3,
    impactCount: spec.id === 'inc-e2' ? 3 : 1,
    evidence: [
      evidence('结束原因', '探测恢复', spec.resolvedAt, 'collector'),
      evidence('持续', spec.id === 'inc-e1' ? '约 1.5 小时' : '约 2 小时', spec.resolvedAt, 'manual'),
    ],
    openedAt: spec.openedAt,
    nextCheckAt: null,
    closure: null,
    lastSeenAt: spec.resolvedAt,
    ackedAt: spec.openedAt + 600,
    snoozedUntil: null,
    resolvedAt: spec.resolvedAt,
  }));
  const details = {};
  items.forEach((incident, i) => {
    details[incident.id] = incidentDetail(incident, rngFor(0x454D50 ^ (i + 1) * 1013904223));
  });
  return {
    clock: CLOCK,
    list: listOf(items),
    details,
  };
}

/**
 * 开通漏斗：名单上还没注册的人，加上有账号但一次都没连上的人。
 *
 * 两半合成一张表，因为运营早上问的是同一个问题——谁开通了还没用起来——而这两半
 * 在库里根本不是一种东西：一半只有一个邮箱在允许登录的名单上，另一半有账号、
 * 有设备，只是从来没连上过。所以 `key` 是这一行的名字：有账号的就是用户号,
 * 没账号的是 `invite:` 加邮箱。
 *
 * "连上过"那一段的人不进 items：这张表是还没走完的人，走完的那些在客户列表里
 * 各自带着自己的健康词。段上的数字仍然把他们算进去，不然漏斗的最后一格永远是零。
 */
function buildFunnel(file, invites) {
  const items = invites.map((invite) => ({
    key: `invite:${invite.email}`,
    userId: null,
    email: invite.email,
    wechatId: invite.wechatId,
    contact: invite.contact,
    notes: invite.notes,
    stage: 'invited',
    stageSinceAt: CLOCK - invite.days * DAY,
    lastSeenAt: null,
  }));
  for (const row of file.list.items) {
    if (row.stage === 'connected') continue;
    const detail = file.details[row.userId].detail;
    items.push({
      key: row.userId,
      userId: row.userId,
      email: row.email,
      wechatId: row.wechatId,
      contact: detail.contact,
      notes: detail.notes,
      stage: row.stage,
      stageSinceAt: row.stageSinceAt,
      lastSeenAt: row.lastSeenAt,
    });
  }
  items.sort((a, b) => a.stageSinceAt - b.stageSinceAt);
  const stages = FUNNEL_STAGES.map((stage) => ({
    stage,
    count: stage === 'connected'
      ? file.list.items.filter((row) => row.stage === 'connected').length
      : items.filter((row) => row.stage === stage).length,
  }));
  return { clock: CLOCK, funnel: { stages, items, updatedAt: CLOCK } };
}

/** 压版式里的名单：很长的邮箱、很长的微信号，一列都不许把地址挤出去。 */
function denseInvites(count) {
  const rows = [];
  for (let n = 1; n <= count; n += 1) {
    const email = `pending.activation.desk-${String(n).padStart(2, '0')}.east-china-backbone.very-long-name@example.com`;
    rows.push({
      email,
      wechatId: n % 4 === 0 ? null : `wx_pending_activation_desk_${String(n).padStart(2, '0')}`,
      contact: n % 3 === 0 ? `+86 139 ${String(2000 + n)} ${String(4000 + n)}` : null,
      notes: n % 5 === 0 ? '销售那边说下周再催一次。' : null,
      days: 1 + (n % 11),
    });
  }
  return rows;
}

/* ------------------------------------------------------- 节点：可售验收单 */

/**
 * The 可售验收 sheets, in the three shapes the section has to survive.
 *
 * They are written here rather than by hand because the sheet is a table with
 * one rule — `sellable === (blockers.length === 0)`, and only 客户去程 and 容量
 * may be `unknown` and still count — and a hand-edited fixture that breaks that
 * rule would put "可以上架" above a list of blockers. `acceptanceSheet` derives
 * both fields from the items, exactly the way the Worker does, so the committed
 * file cannot disagree with itself.
 *
 * `evidence` is copied from the Worker's own wording rather than invented: the
 * fixtures are the only thing the page is reviewed against, and a screenshot
 * of sentences the Worker never writes reviews nothing.
 */
const ACCEPTANCE_LABELS = {
  profile: '资料齐全',
  'binding.catalog': '目录登记',
  'binding.exitToken': '出口令牌',
  'binding.komari': '探针',
  'binding.identitySync': '身份同步',
  'binding.metering': '计量',
  carriers: '大陆三网探测',
  forward: '客户去程',
  errors: '后台无报错',
  quota: '流量配额已设',
  capacity: '容量',
  standby: '替代机器',
};

/** The order the Worker emits, which is the order an operator reads. */
const ACCEPTANCE_ORDER = Object.keys(ACCEPTANCE_LABELS);

/** The two that need a real customer; nothing else may stay unknown. */
const ACCEPTANCE_SOFT = new Set(['forward', 'capacity']);

const ACCEPTANCE_SOURCE = {
  profile: 'profile',
  'binding.catalog': 'catalog',
  'binding.exitToken': 'telemetry',
  'binding.komari': 'komari',
  'binding.identitySync': 'telemetry',
  'binding.metering': 'telemetry',
  carriers: 'komari',
  forward: 'telemetry',
  errors: 'jobs',
  quota: 'profile',
  capacity: 'profile',
  standby: 'catalog',
};

function acceptanceSheet(rows) {
  const items = ACCEPTANCE_ORDER.map((key) => {
    const row = rows[key];
    return {
      key,
      label: ACCEPTANCE_LABELS[key],
      state: row.state,
      evidence: row.evidence ?? null,
      asOfSec: row.asOfSec ?? null,
      source: row.source ?? ACCEPTANCE_SOURCE[key],
    };
  });
  const blockers = items
    .filter((item) => item.state !== 'pass' && !(item.state === 'unknown' && ACCEPTANCE_SOFT.has(item.key)))
    .map((item) => item.key);
  const asOfSec = items.reduce(
    (latest, item) => (item.asOfSec === null ? latest : Math.max(latest ?? 0, item.asOfSec)),
    null,
  );
  return { items, sellable: blockers.length === 0, blockers, asOfSec };
}

const FRESH = CLOCK - 11 * 60;
const SWEPT = CLOCK - 3 * HOUR;

/** Every line green but 容量, which nothing writes a ceiling for. */
const SELLABLE_SHEET = acceptanceSheet({
  profile: { state: 'pass', evidence: 'Bandwagon，价格、续费和线路标签都填过了', asOfSec: CLOCK - DAY },
  'binding.catalog': { state: 'pass', evidence: '在客户端的节点单子里', asOfSec: FRESH },
  'binding.exitToken': { state: 'pass', evidence: '最近取过出口令牌', asOfSec: FRESH },
  'binding.komari': { state: 'pass', evidence: '探针在报数', asOfSec: FRESH },
  'binding.identitySync': { state: 'pass', evidence: '取过账号名单', asOfSec: FRESH },
  'binding.metering': { state: 'pass', evidence: '计量最近上报过', asOfSec: FRESH },
  carriers: { state: 'pass', evidence: '三网都测到了：联通丢包 1%，电信丢包 0%，移动丢包 2%', asOfSec: SWEPT },
  forward: { state: 'pass', evidence: '最近 7 天大陆客户连上过 214 次', asOfSec: CLOCK - 40 * 60 },
  errors: { state: 'pass', evidence: '最近一天 2 条后台报错', asOfSec: CLOCK - HOUR },
  quota: { state: 'pass', evidence: '额度 2000 GB，周期已经在走', asOfSec: CLOCK - DAY },
  capacity: { state: 'unknown', evidence: '现在 9 人在用，但还没登记这台机器坐得下多少人', asOfSec: CLOCK - 5 * 60 },
  standby: { state: 'pass', evidence: '东京 还有 2 台在售：Tokyo · Fuji、Tokyo · Kite', asOfSec: CLOCK },
});

/** Walled, half-registered, and nothing to hand it over to. */
const BLOCKED_SHEET = acceptanceSheet({
  profile: { state: 'fail', evidence: '还没填：价格、线路标签', asOfSec: CLOCK - 6 * DAY },
  'binding.catalog': { state: 'fail', evidence: '还不在客户端的节点单子里', asOfSec: CLOCK - 2 * HOUR },
  'binding.exitToken': { state: 'pass', evidence: '最近取过出口令牌', asOfSec: CLOCK - 2 * HOUR },
  'binding.komari': { state: 'pass', evidence: '探针在报数', asOfSec: CLOCK - 2 * HOUR },
  'binding.identitySync': { state: 'fail', evidence: '还没取过账号名单', asOfSec: CLOCK - 2 * HOUR },
  'binding.metering': { state: 'pass', evidence: '计量最近上报过', asOfSec: CLOCK - 2 * HOUR },
  carriers: { state: 'fail', evidence: '扫描说这台机器疑似被墙', asOfSec: SWEPT, source: 'collector' },
  forward: { state: 'fail', evidence: '大陆客户试了 26 次，一次都没连上', asOfSec: CLOCK - 25 * 60 },
  errors: { state: 'fail', evidence: '最近一天有 41 条后台报错，最多的是 reality_auth', asOfSec: CLOCK - HOUR },
  quota: { state: 'pass', evidence: '额度 1000 GB，周期已经在走', asOfSec: CLOCK - 3 * DAY },
  capacity: { state: 'unknown', evidence: '现在 0 人在用，但还没登记这台机器坐得下多少人', asOfSec: CLOCK - 8 * 60 },
  standby: { state: 'fail', evidence: '大阪 没有第二台在售的机器', asOfSec: CLOCK },
});

/** A machine nobody has measured: the answers are missing, not bad. */
const UNKNOWN_SHEET = acceptanceSheet({
  profile: { state: 'fail', evidence: '还没填：商家、价格、续费日或到期日、线路标签', asOfSec: CLOCK - 30 * DAY },
  'binding.catalog': { state: 'fail', evidence: '还不在客户端的节点单子里', asOfSec: null },
  'binding.exitToken': { state: 'fail', evidence: '最近没有取过出口令牌', asOfSec: null },
  'binding.komari': { state: 'fail', evidence: '这台机器上没有探针在报数', asOfSec: null },
  'binding.identitySync': { state: 'fail', evidence: '还没取过账号名单', asOfSec: null },
  'binding.metering': { state: 'fail', evidence: '计量最近没有上报', asOfSec: null },
  carriers: { state: 'pending', evidence: '重测大陆可达已经排队，等这一轮结果', asOfSec: null },
  forward: { state: 'unknown', evidence: '还没有客户连过', asOfSec: null },
  errors: { state: 'unknown', evidence: '还没拉过这台机器的后台报错', asOfSec: null },
  quota: { state: 'fail', evidence: '还没登记流量额度和周期', asOfSec: null },
  capacity: { state: 'unknown', evidence: '还没登记这台机器坐得下多少人，现在也没测到有人在用', asOfSec: null },
  standby: { state: 'unknown', evidence: '目录读不出来，点不出替代机器', asOfSec: null },
});

/**
 * Which sheet a given machine gets, and how it is listed.
 *
 * The listing travels with the sheet because a 可售验收单 only means anything on
 * a machine that is not being sold yet: the two named here are the unlisted
 * pair the 上架 path is reviewed against, and the committed 节点详情 file has no
 * unlisted machine of its own.
 */
const ACCEPTANCE_NODES = {
  'Osaka · Wave': { sheet: 'blocked', lifecycle: 'unlisted', catalogListed: false },
  'Kyoto · Deer': { sheet: 'sellable', lifecycle: 'unlisted', catalogListed: false },
};

const nodeAcceptance = {
  clock: CLOCK,
  sheets: { sellable: SELLABLE_SHEET, blocked: BLOCKED_SHEET, unknown: UNKNOWN_SHEET },
  nodes: ACCEPTANCE_NODES,
  /** The fixture set's own default, for any machine not named above. */
  bySet: { default: 'sellable', dense: 'blocked', empty: 'unknown' },
};

const thisFile = fileURLToPath(import.meta.url);
const defaultDir = join(dirname(thisFile), '..', 'fixtures');

/**
 * Files this script is allowed to emit. The test asserts the set, so a new
 * write has to be named here rather than appearing as a surprise on disk.
 */
export const GENERATED_FIXTURE_FILES = [
  'customers.json',
  'customers.dense.json',
  'customers.empty.json',
  'funnel.json',
  'funnel.dense.json',
  'funnel.empty.json',
  'incidents.json',
  'incidents.dense.json',
  'incidents.empty.json',
  'node-acceptance.json',
];

export function generateOpsFixtures(outDir = defaultDir) {
  const customers = buildCustomers(20);
  const customersDense = buildCustomers(60);
  const customersEmpty = {
    clock: CLOCK,
    list: listOf([]),
    details: {},
  };
  const funnel = buildFunnel(customers, INVITED);
  const funnelDense = buildFunnel(customersDense, denseInvites(14));
  const funnelEmpty = {
    clock: CLOCK,
    funnel: {
      stages: FUNNEL_STAGES.map((stage) => ({ stage, count: 0 })),
      items: [],
      updatedAt: CLOCK,
    },
  };
  const incidents = buildCoreIncidents();
  const incidentsDense = buildDenseIncidents();
  const incidentsEmpty = buildEmptyIncidents();

  function writeJson(name, data, pretty = false) {
    // Customers stay compact: 60 people × 168 hours of activity would grow by
    // several megabytes if indented. Incidents were committed pretty-printed
    // (they are small, and the pages read them as documents), so they stay
    // indented — regenerating must not collapse them.
    const body = `${pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)}\n`;
    writeFileSync(join(outDir, name), body);
    return Buffer.byteLength(body);
  }

  const sizes = {
    'customers.json': writeJson('customers.json', customers),
    'customers.dense.json': writeJson('customers.dense.json', customersDense),
    'customers.empty.json': writeJson('customers.empty.json', customersEmpty),
    'funnel.json': writeJson('funnel.json', funnel),
    'funnel.dense.json': writeJson('funnel.dense.json', funnelDense),
    'funnel.empty.json': writeJson('funnel.empty.json', funnelEmpty),
    'incidents.json': writeJson('incidents.json', incidents, true),
    'incidents.dense.json': writeJson('incidents.dense.json', incidentsDense, true),
    'incidents.empty.json': writeJson('incidents.empty.json', incidentsEmpty, true),
    'node-acceptance.json': writeJson('node-acceptance.json', nodeAcceptance),
  };

  const verdictCounts = {};
  let connectedTrue = 0;
  for (const row of customers.list.items) {
    verdictCounts[row.verdict] = (verdictCounts[row.verdict] ?? 0) + 1;
    if (row.connected.value === true) connectedTrue += 1;
  }
  const open = incidents.list.items.filter((row) => row.status === 'open');
  const resolved = incidents.list.items.filter((row) => row.status === 'resolved');
  const rootImpact = open
    .filter((row) => row.parentIncidentId === null)
    .reduce((sum, row) => sum + row.impactCount, 0);

  console.log(`customers ${customers.list.items.length} connectedTrue ${connectedTrue} verdicts ${JSON.stringify(verdictCounts)}`);
  console.log(`incidents open ${open.length} resolved ${resolved.length} rootImpact ${rootImpact}`);
  console.log(`acceptance blockers ${JSON.stringify(
    Object.fromEntries(Object.entries(nodeAcceptance.sheets).map(([name, sheet]) => [name, sheet.blockers.length])),
  )}`);
  console.log(`sizes ${JSON.stringify(sizes)}`);
  console.log(`u-04 connections ${customers.details['u-04'].connections.total} activity ${customers.details['u-04'].activity.total} dest ${customers.details['u-04'].destinations.total}`);
  return sizes;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === thisFile) {
  // `--out <dir>` writes somewhere else, which is how a parity test regenerates
  // into a scratch directory instead of overwriting the files it is comparing.
  const outFlag = process.argv.indexOf('--out');
  generateOpsFixtures(outFlag === -1 ? undefined : resolve(process.argv[outFlag + 1]));
}
