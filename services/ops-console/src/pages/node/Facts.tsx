import { Check } from 'lucide-react';
import type { Measured as ContractMeasured, NodeBindingsDto, NodeFactsDto, NodeQuotaDto } from '@contract';
import { Action } from '@/components/ops/Action';
import { Fact } from '@/components/ops/DetailDrawer';
import { QuotaGauge } from '@/components/ops/QuotaGauge';
import { Section } from '@/components/ops/Section';
import { Value } from '@/components/ops/Value';
import { absent, measured, type Measured } from '@/components/ops/measured';
import { copy } from '@/copy/copy';
import { formatDate, formatWhenAgo } from '@/lib/display';
import { formatBillingCycle, formatDeadline, formatMoney } from '@/lib/node-detail';
import { usePrivacy } from '@/lib/privacy';
import { sourceWord } from '@/lib/sources';

/**
 * The flat facts about the machine, all of them hand-kept.
 *
 * They share one stamp — the profile's `updatedAt` — because they were all
 * typed in at once and nothing measures them; dating the price differently
 * from the renewal date would suggest one of them came from the machine.
 *
 * And because nothing measures them, the edit affordance belongs on this
 * heading and on no other: every dash in this block is a dash until somebody
 * types the answer, which is why the block was nine of them on production.
 */
export function NodeFacts({ facts, onEdit }: { facts: NodeFactsDto; onEdit: () => void }) {
  const privacy = usePrivacy();
  const at = facts.updatedAt;
  const say = (value: string | null): Measured<string | null> => (
    value ? measured(value, at, copy.sourceWord.profile) : absent(copy.sourceWord.profile)
  );
  const money = formatMoney(facts.price, facts.currency);
  const cycle = formatBillingCycle(facts.billingCycle);

  return (
    <Section
      title={copy.nodeSections.facts}
      aside={<Action onClick={onEdit}>{copy.nodeEdit}</Action>}
    >
      <div className="grid gap-x-8 sm:grid-cols-2">
        <Fact label={copy.nodeFacts.ip} measured={say(facts.publicIp)} render={privacy.ip} />
        <Fact label={copy.nodeFacts.os} measured={say(facts.os)} />
        <Fact label={copy.nodeFacts.provider} measured={say(facts.provider)} />
        <AccountFact id={facts.providerAccountId} />
        <Fact
          label={copy.nodeFacts.tags}
          measured={say(facts.lineTags.length === 0 ? null : facts.lineTags.join(' · '))}
        />
        <Fact label={copy.nodeFacts.port} measured={say(facts.port === null ? null : String(facts.port))} />
        <Fact
          label={copy.nodeFacts.price}
          measured={say(money === null ? null : (cycle === null ? money : copy.nodePrice(money, cycle)))}
          render={privacy.money}
        />
        <Fact label={copy.nodeFacts.renew} measured={when(facts.renewsAt, at)} />
        <Fact label={copy.nodeFacts.expires} measured={when(facts.expiresAt, at)} />
        <Fact label={copy.nodeFacts.notes} measured={say(facts.notes)} />
      </div>
    </Section>
  );
}

/** Renewal and expiry read as both: the relative answers, the date settles it. */
function when(value: number | null, at: number): Measured<string | null> {
  if (value === null) return absent(copy.sourceWord.profile);
  const relative = formatDeadline(value) ?? copy.missing;
  return measured(copy.nodeWhenBoth(relative, formatDate(value)), at, copy.sourceWord.profile);
}

function AccountFact({ id }: { id: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--hairline)] py-2">
      <span className="text-micro text-[var(--muted-foreground)]">{copy.nodeFacts.account}</span>
      {id === null ? (
        <Value value={null} source={copy.sourceWord.profile} mono className="text-right" />
      ) : (
        <a
          href="#/settings/providers"
          title={copy.nodeAccountLink}
          className="truncate text-right font-mono text-row underline decoration-[var(--hairline)] underline-offset-4 hover:decoration-[var(--accent)]"
        >
          {id}
        </a>
      )}
    </div>
  );
}

const BINDING_ORDER = ['catalog', 'exitToken', 'komari', 'identitySync', 'metering'] as const;

/**
 * The five places a node has to be written down.
 *
 * A missing tick is a chore, in the chore tone, and never an incident: a node
 * nobody added to the meter is still serving customers perfectly well, and
 * colouring it red beside a blocked node would teach the operator to ignore both.
 */
export function NodeBindings({ bindings }: { bindings: NodeBindingsDto }) {
  const missing = BINDING_ORDER.filter((key) => !bindings[key]);

  return (
    <Section
      title={copy.nodeSections.bindings}
      aside={
        <span className="text-micro text-[var(--muted-foreground)]">
          {bindings.asOfSec === null
            ? copy.nodeBindingsNever
            : `${copy.nodeBindingsAsOf} ${formatWhenAgo(bindings.asOfSec)}`}
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {BINDING_ORDER.map((key) => (
          bindings[key] ? (
            <span key={key} className="ops-tag gap-1">
              <Check size={11} strokeWidth={2} />
              {copy.nodeBindingLabels[key]}
            </span>
          ) : (
            <span key={key} className="ops-tag tone-rem">
              {copy.nodeBindingTodo(copy.nodeBindingLabels[key])}
            </span>
          )
        ))}
      </div>
      {missing.length === 0 ? (
        <p className="text-micro text-[var(--muted-foreground)]">{copy.nodeBindingsAllDone}</p>
      ) : null}
    </Section>
  );
}

/**
 * This cycle's traffic, quoting the meter's own forecast rather than a second
 * one drawn here: two exhaustion dates for one machine is how a console starts
 * arguing with itself.
 */
export function NodeQuota({ quota }: { quota: ContractMeasured<NodeQuotaDto> }) {
  const row = quota.value;
  const used: Measured<number | null> = measured(row.used, quota.asOfSec, sourceWord(quota.source));
  const cycle = row.cycleStart === null || row.cycleEnd === null
    ? copy.nodeQuotaNoCycle
    : copy.nodeQuotaCycle(formatDate(row.cycleStart), formatDate(row.cycleEnd));

  return (
    <Section
      title={copy.nodeSections.quota}
      aside={<span className="text-micro text-[var(--muted-foreground)]">{cycle}</span>}
    >
      <QuotaGauge
        used={used}
        quota={row.quota}
        cycleStartSec={row.cycleStart}
        exhaustAtSec={row.projectedExhaustAt}
        className="max-w-[520px]"
      />
    </Section>
  );
}
