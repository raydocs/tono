import type { ConfidenceLevel, MetricDto, PayoffDto, WorthwhilePickDto } from '@contract';
import { copy } from '@/copy/copy';
import { formatBytesMeasured, formatCount } from './display';
import { formatCny } from './ledger';

/**
 * 本周三件事, turned into words.
 *
 * The hub deliberately sends no sentences: a kind, a name, a measurement and a
 * payoff. Everything that turns those into a line an operator reads happens
 * here, where it is pure and can be tested without a browser, and the words
 * themselves live in `src/copy/worthwhile.ts`.
 */

export function confidenceWord(level: ConfidenceLevel): string {
  return copy.worthwhileSure[level];
}

/** The fact behind a pick, in the unit it was measured in. */
export function metricText(metric: MetricDto | null): string {
  if (metric === null) return copy.missing;
  if (metric.kind === 'bytes') return formatBytesMeasured(metric.value);
  if (metric.kind === 'cnyMinor') return formatCny(metric.value) ?? copy.missing;
  if (metric.kind === 'days') return copy.worthwhileUnit.days(formatCount(metric.value));
  if (metric.kind === 'incidents') return copy.worthwhileUnit.incidents(formatCount(metric.value));
  return copy.worthwhileUnit.customers(formatCount(metric.value));
}

/**
 * What doing it is worth.
 *
 * An estimate is marked as one, in front of the number and again after it: a
 * guessed yuan that reads exactly like a measured yuan is the one thing this
 * block must never do. Nothing to claim says so rather than showing a zero,
 * because zero is a measurement and "cannot be estimated" is not.
 */
export function payoffText(payoff: PayoffDto | null): string {
  if (payoff === null) return copy.worthwhileNoPayoff;
  const amount = amountText(payoff);
  return payoff.isEstimate ? copy.worthwhileAbout(amount) : amount;
}

function amountText(payoff: PayoffDto): string {
  if (payoff.kind === 'cny') return formatCny(payoff.value) ?? copy.missing;
  if (payoff.kind === 'hours') return copy.worthwhileUnit.hours(formatCount(payoff.value));
  return copy.worthwhileUnit.customers(formatCount(payoff.value));
}

/**
 * The whole line, given a label the caller has already made display-safe.
 *
 * The label is a parameter rather than read off the pick because masking a
 * customer id is a rendering decision that depends on the privacy switch, and
 * this function has no business knowing whether that switch is on.
 */
export function sentenceOf(pick: WorthwhilePickDto, label: string): string {
  return copy.worthwhileLine[pick.kind](label, metricText(pick.metric));
}
