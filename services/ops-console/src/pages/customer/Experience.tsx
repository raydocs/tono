import type { CustomerDeviceDto, CustomerNowDto } from '@contract';
import { EmptyLine } from '@/components/ops/Empty';
import { measured } from '@/components/ops/measured';
import { MetricCard } from '@/components/ops/MetricCard';
import { Section } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { sloApi } from '@/lib/api-slo';
import { sloCarrierOf, sloNodeOf } from '@/lib/customer-slo';
import { formatCount, splitPercent } from '@/lib/display';
import { useResource } from '@/lib/use-resource';

const words = copy.customerSlo;

/**
 * What the last month was actually like for somebody on this customer's node
 * and carrier: success rate, median time to connect, verified outage and the
 * minutes nobody measured. It is the daily SLO rollup filtered to the pair,
 * not this one person's attempts, and the scope line says which pair.
 */
export function Experience({
  now,
  devices,
}: {
  now: CustomerNowDto | null;
  devices: readonly CustomerDeviceDto[];
}) {
  const node = sloNodeOf(now, devices);
  const carrier = sloCarrierOf(now?.carrier ?? null);
  const slo = useResource(
    node === null ? null : `customer-slo-30d-${node}-${carrier ?? ''}`,
    (signal) => sloApi.get({ range: '30d', node: node ?? undefined, carrier: carrier ?? undefined }, signal),
  );
  const scope = node === null ? null : words.scope(node, carrier === null ? null : words.carrier[carrier]);

  return (
    <Section
      title={words.title}
      aside={<span className="text-micro text-[var(--muted-foreground)]">{words.range}</span>}
    >
      {node === null ? (
        <EmptyLine message={words.noNode} />
      ) : slo.status !== 'ready' ? (
        <EmptyLine message={slo.status === 'error' ? slo.message : copy.loading} />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-body text-[var(--muted-foreground)]">{scope}</p>
          {slo.data.items.length === 0 ? <EmptyLine message={words.none} /> : null}
          <div className="grid gap-4 border-y border-[var(--hairline)] py-4 sm:grid-cols-4">
            <MetricCard
              label={words.successRate}
              value={measured(slo.data.summary.successRate, slo.data.updatedAt, copy.sourceWord.telemetry)}
              format={splitPercent}
            />
            <MetricCard
              label={words.p50}
              value={measured(slo.data.summary.p50Ms, slo.data.updatedAt, copy.sourceWord.telemetry)}
              format={(value) => ({ number: formatCount(value), unit: copy.ledger.sloUnitMs })}
            />
            <MetricCard
              label={words.outage}
              value={measured(slo.data.summary.verifiedOutageMin, slo.data.updatedAt, copy.sourceWord.telemetry)}
              format={(value) => ({ number: formatCount(value), unit: copy.ledger.sloUnitMin })}
            />
            <MetricCard
              label={words.unmeasured}
              value={measured(slo.data.summary.unmeasuredMin, slo.data.updatedAt, copy.sourceWord.telemetry)}
              format={(value) => ({ number: formatCount(value), unit: copy.ledger.sloUnitMin })}
            />
          </div>
        </div>
      )}
    </Section>
  );
}
