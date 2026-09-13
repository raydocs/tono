import type { ConfidenceLevel, MetricDto, PayoffDto, WorthwhilePickDto } from '@contract';
import { copy } from '@/copy/copy';
import { formatBytesMeasured, formatCount } from './display';
import { formatCny } from './ledger';

export function confidenceWord(level: ConfidenceLevel): string {
  return copy.worthwhileSure[level];
}

export function metricText(metric: MetricDto | null): string {
  if (metric === null) return copy.missing;
  if (metric.kind === 'bytes') return formatBytesMeasured(metric.value);
  if (metric.kind === 'cnyMinor') return formatCny(metric.value) ?? copy.missing;
  if (metric.kind === 'days') return copy.worthwhileUnit.days(formatCount(metric.value));
  if (metric.kind === 'incidents') return copy.worthwhileUnit.incidents(formatCount(metric.value));
  return copy.worthwhileUnit.customers(formatCount(metric.value));
}

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

export function sentenceOf(pick: WorthwhilePickDto, label: string): string {
  return copy.worthwhileLine[pick.kind](label, metricText(pick.metric));
}
