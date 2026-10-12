import type {
  ConnectionEventDto,
  CustomerDeviceDto,
  CustomerNowDto,
  IncidentDto,
  NodeSummaryDto,
  Platform,
} from '@contract';
import { copy } from '@/copy/copy';
import { explainCode, stageWord } from './codes';
import { formatWhen } from './display';
import { compareVersions } from './releases';

/**
 * The reply draft, in three parts an operator can each leave out.
 *
 * 已确认 is what the page measured about the failed attempt; 待确认 is what
 * only the customer can settle (an old client, a node they already left);
 * 建议 is the one machine worth moving to. Every line is a copy function fed a
 * field — nothing here names a cause no field measured.
 */
export const REPLY_SECTIONS = ['confirmed', 'pending', 'suggestion'] as const;
export type ReplySection = (typeof REPLY_SECTIONS)[number];

/**
 * A machine to send the customer to instead.
 *
 * Only the engine's own verdict decides: a node it still calls 正常, listed in
 * the catalogue, and not the one that just failed. A suggestion made from
 * anything softer than that is the console inventing a recovery promise.
 * Among those, one in the failed machine's region comes first, then the best
 * outbound (去程) success rate on its worst carrier; unmeasured rates go last.
 */
export function spareNode(
  nodes: readonly NodeSummaryDto[],
  avoid: string | null,
): string | null {
  const region = nodes.find((row) => row.name === avoid)?.region ?? null;
  const rate = (row: NodeSummaryDto) => row.forwardWorst.value?.successRate ?? -1;
  const usable = nodes
    .filter((row) => row.verdict === 'ok' && row.lifecycle === 'listed' && row.name !== avoid)
    .map((row, index) => ({ row, index, near: region !== null && row.region === region ? 0 : 1 }))
    .sort((a, b) => a.near - b.near || rate(b.row) - rate(a.row) || a.index - b.index);
  return usable[0]?.row.name ?? null;
}

/** The question worth asking back, chosen by the code the client reported. */
function questionFor(code: string | null): string {
  const asks = copy.replyQuestion as Record<string, string>;
  const key = (code ?? '').toUpperCase();
  return asks[key] ?? copy.replyQuestion.other;
}

export type ReplyInput = {
  who: string;
  failure: ConnectionEventDto;
  incident: IncidentDto | null;
  spare: string | null;
  /** The customer's 现在 block; its carrier stands in when the attempt has none. */
  now?: CustomerNowDto | null;
  devices?: readonly CustomerDeviceDto[];
  /** Newest published stable version per platform (releases/channels). */
  latest?: Partial<Record<Platform, string>> | null;
};

/**
 * The carrier as Cloudflare saw the upload. An upload that went out through
 * one of our own exits shows the exit's network, not the customer's, so it
 * is not quoted.
 */
function carrierOf(failure: ConnectionEventDto, now: CustomerNowDto | null): string | null {
  if (!failure.edgeViaExit && failure.edgeAsOrg) return failure.edgeAsOrg;
  return now?.carrier ?? null;
}

function versionLine(input: ReplyInput, device: CustomerDeviceDto | null): string {
  const said = copy.replyLine;
  const running = input.failure.appVersion ?? device?.appVersion ?? null;
  const platform = input.failure.platform ?? device?.platform ?? null;
  const latest = platform === null ? null : input.latest?.[platform] ?? null;
  if (running === null) return said.versionUnknown;
  if (latest === null) return said.versionNoRelease(running);
  return compareVersions(running, latest) < 0
    ? said.versionBehind(running, latest)
    : said.versionCurrent(running);
}

function switchLine(failure: ConnectionEventDto, device: CustomerDeviceDto | null): string | null {
  const said = copy.replyLine;
  const selected = device?.selectedServer ?? null;
  if (failure.node === null || selected === null) return null;
  return selected === failure.node ? said.switchedNo(selected) : said.switchedTo(selected);
}

export function replySections(input: ReplyInput): Record<ReplySection, string[]> {
  const { failure, incident, spare } = input;
  const said = copy.replyLine;
  const at = formatWhen(Math.floor(failure.atMs / 1_000));
  const confirmed = [failure.node === null ? said.attemptNoNode(at) : said.attempt(at, failure.node)];
  const stage = stageWord(failure.stage);
  const why = explainCode(failure.code);
  if (stage !== null && why !== null) {
    confirmed.push(failure.code === null
      ? said.stage(stage, why)
      : said.stageCode(stage, failure.code, why));
  }
  const carrier = carrierOf(failure, input.now ?? null);
  if (carrier !== null) confirmed.push(said.carrier(carrier));
  confirmed.push(incident === null ? said.incidentNo : said.incidentYes(incident.title));

  const device = (input.devices ?? []).find((row) => row.id === failure.deviceId) ?? null;
  const pending = [versionLine(input, device)];
  const switched = switchLine(failure, device);
  if (switched !== null) pending.push(switched);
  pending.push(said.question(questionFor(failure.code)));

  const suggestion = [spare === null ? said.alternativeNone : said.alternative(spare)];
  return { confirmed, pending, suggestion };
}

/**
 * The reply, assembled from fields and nothing else: a greeting, then each
 * part the operator kept, under its heading. With no `include` every part is
 * kept.
 */
export function replyDraft(
  input: ReplyInput & { include?: ReadonlySet<ReplySection> },
): string {
  const parts = replySections(input);
  const blocks = [copy.replyLine.greeting(input.who)];
  for (const section of REPLY_SECTIONS) {
    if (input.include && !input.include.has(section)) continue;
    blocks.push([copy.replySection[section], ...parts[section]].join('\n'));
  }
  return blocks.join('\n\n');
}
