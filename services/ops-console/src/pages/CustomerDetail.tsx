import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Fact } from '@/components/ops/DetailDrawer';
import { Empty } from '@/components/ops/Empty';
import { HeatStrip } from '@/components/ops/HeatStrip';
import { Section } from '@/components/ops/Section';
import { StatusWord } from '@/components/ops/StatusWord';
import { copy } from '@/copy/copy';
import { opsApi } from '@/lib/api';
import { customerApi } from '@/lib/api-customer-actions';
import { formatDate } from '@/lib/display';
import { closeCustomer } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';
import { useResource, type Resource } from '@/lib/use-resource';
import { measured } from '@/components/ops/measured';
import '@/styles/customer-detail.css';
import { Billing } from './customer/Billing';
import { CustomerChores } from './customer/ChoreList';
import { CarrierMatrix } from './customer/CarrierMatrix';
import { ClaudeAccount } from './customer/ClaudeAccount';
import { Destinations } from './customer/Destinations';
import { Devices } from './customer/Devices';
import { Followups } from './customer/Followups';
import { CustomerHeader, CustomerWechat } from './customer/Header';
import { HomeLine } from './customer/HomeLine';
import { nowFacts } from './customer/now-facts';
import { Proof } from './customer/Proof';
import { Quota } from './customer/Quota';
import { ReplyDraft } from './customer/ReplyDraft';
import { ServiceUsage } from './customer/Services';
import { Timeline } from './customer/Timeline';

const RANGE = '7d' as const;

/**
 * The last answer that arrived, kept on screen while the next one is fetched.
 *
 * Every write on this page refetches, and a refetch starts as `loading`. Left
 * alone that empties the page for a moment: the sections unmount, the folds
 * the operator had opened close, and the browser puts them back at the top —
 * so queueing a diagnostic on the third device throws you away from the
 * device you were looking at. Holding the previous read means the page keeps
 * saying what it last knew until it knows something newer, which is also the
 * more honest of the two: it was true a second ago, and blank was never true.
 *
 * `key` is the customer, so opening a second one does not show the first
 * one's facts while its own read is in flight.
 */
function useSticky<T>(key: string, resource: Resource<T>): {
  data: T | null;
  loading: boolean;
  message: string | null;
} {
  const [seen, setSeen] = useState<{ key: string; data: T } | null>(null);
  useEffect(() => {
    if (resource.status !== 'ready') return;
    const fresh = resource.data;
    setSeen((current) => (
      current !== null && current.key === key && current.data === fresh
        ? current
        : { key, data: fresh }
    ));
  }, [key, resource]);
  const kept = seen !== null && seen.key === key ? seen.data : null;
  const data = resource.status === 'ready' ? resource.data : kept;
  return {
    data,
    loading: data === null && resource.status === 'loading',
    message: data === null && resource.status === 'error' ? resource.message : null,
  };
}

export default function CustomerDetailPage({ userId }: { userId: string }) {
  const privacy = usePrivacy();
  const detail = useResource(userId, (signal) => opsApi.customer(userId, signal));
  const connections = useResource(userId, (signal) => opsApi.customerConnections(userId, signal));
  const activity = useResource(userId, (signal) => opsApi.customerActivity(userId, RANGE, signal));
  const destinations = useResource(userId, (signal) => opsApi.customerDestinations(userId, RANGE, signal));
  const services = useResource(userId, (signal) => opsApi.customerServices(userId, RANGE, signal));
  /**
   * The two reads the typed contract does not cover: the account side of this
   * customer — their Claude account, the reports they have sent, the proof that
   * their traffic leaves where it should — and which residential line they are
   * bound to. Both are separate requests rather than fields on the customer
   * because they are separate endpoints, and both are written to by the
   * sections below, which is why `refresh` pulls all three back together: a
   * suspension unbinds the line and retires the account, so refetching only
   * the one section that was pressed would leave two of them lying.
   */
  const account = useResource(userId, (signal) => customerApi.accountDetail(userId, signal));
  const binding = useResource(userId, (signal) => customerApi.homeBinding(userId, signal));

  /**
   * `beat` is what tells the followup record to read itself again. The
   * header's actions write their own record — a diagnostic nobody wrote down
   * is a diagnostic nobody can prove was run — and the section that shows
   * those records is not one of the three reads below.
   */
  const [beat, setBeat] = useState(0);
  const refresh = useCallback(() => {
    detail.reload();
    account.reload();
    binding.reload();
    setBeat((n) => n + 1);
  }, [detail, account, binding]);

  const customer = useSticky(userId, detail);
  const accountSide = useSticky(userId, account);
  const homeSide = useSticky(userId, binding);

  const row = customer.data;
  if (row === null) {
    return (
      <div className="page-wrap">
        <BackLink />
        <Empty message={customer.loading ? copy.loading : customer.message || copy.loadError} />
      </div>
    );
  }

  const events = connections.status === 'ready' ? connections.data.items : [];

  return (
    <div className="page-wrap customer-detail-page">
      <BackLink />

      <header className="customer-hero-card flex flex-col gap-3" aria-label={privacy.email(row.email)}>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-verdict">{privacy.email(row.email)}</h1>
          <StatusWord word={row.health} reason={row.reason} />
          <span className="ops-tag">{copy.lifecycle[row.lifecycle]}</span>
          <CustomerWechat wechatId={row.wechatId} />
        </div>
        {row.reason ? (
          <p className="text-body text-[var(--muted-foreground)]">{row.reason}</p>
        ) : null}
        <div className="grid gap-5 border-y border-[var(--hairline)] py-4 sm:grid-cols-2">
          <Fact
            label={copy.expiresAt}
            measured={measured(
              row.billing.expiresAt === null ? null : formatDate(row.billing.expiresAt),
              row.billing.expiresAt,
              copy.sourceWord.profile,
            )}
          />
          <Quota billing={row.billing} />
        </div>
        <CustomerHeader row={row} onChanged={refresh} />
      </header>

      {/* The connection story reads down the main column; the account side
          sits aside. DOM order is the reading order, so the phone keeps it
          and the desktop grid places explicitly. */}
      <div className="customer-grid">
        <div className="customer-main">
          <Section title={copy.customerSections.now}>
            <div className="grid gap-x-8 sm:grid-cols-2">
              {nowFacts(row).map((fact) => (
                <Fact key={fact.label} label={fact.label} measured={fact.measured} tier={fact.tier} />
              ))}
            </div>
          </Section>

          {/* The answer, then the record of having given it. Both sit above the
              timeline because both are what the operator came here to do; the
              timeline is what they read to check the draft. */}
          <ReplyDraft who={privacy.email(row.email)} events={events} />

          <Followups userId={userId} beat={beat} />

          <Timeline
            events={events}
            devices={row.devices}
            state={connections.status}
            message={connections.status === 'error' ? connections.message : undefined}
          />

          <Section
            title={copy.customerSections.activity}
            aside={<span className="text-micro text-[var(--muted-foreground)]">{copy.timelineFilters.week}</span>}
          >
            {activity.status === 'ready' ? (
              <HeatStrip rows={activity.data.items} source={copy.sourceWord.telemetry} />
            ) : (
              <Empty message={activity.status === 'loading' ? copy.loading : copy.loadError} />
            )}
          </Section>

          <Destinations
            rows={destinations.status === 'ready' ? destinations.data.items : []}
            state={destinations.status}
            message={destinations.status === 'error' ? destinations.message : undefined}
          />

          <ServiceUsage
            rows={services.status === 'ready' ? services.data.items : []}
            state={services.status}
            message={services.status === 'error' ? services.message : undefined}
          />

          <CarrierMatrix events={events} />

          <Devices userId={userId} devices={row.devices} onChanged={refresh} />
        </div>

        <div className="customer-aux-card">
          <HomeLine
            userId={userId}
            email={privacy.email(row.email)}
            binding={homeSide.data ?? null}
            loading={homeSide.loading}
            message={homeSide.message}
            onChanged={refresh}
          />

          <ClaudeAccount
            userId={userId}
            detail={accountSide.data}
            loading={accountSide.loading}
            message={accountSide.message}
            onChanged={refresh}
          />

          <Proof
            detail={accountSide.data}
            loading={accountSide.loading}
            message={accountSide.message}
            logWindows={row.logWindows}
          />

          <CustomerChores chores={row.chores} />

          <Billing
            userId={userId}
            billing={row.billing}
            firstConnectedAt={row.firstConnectedAt}
            profile={{ wechatId: row.wechatId, contact: row.contact, notes: row.notes }}
            updatedAt={row.updatedAt}
            onChanged={refresh}
          />
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 self-start text-micro text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      onClick={closeCustomer}
    >
      <ArrowLeft size={12} strokeWidth={1.75} />
      {copy.pages.customers}
    </button>
  );
}
