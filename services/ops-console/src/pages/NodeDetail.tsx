import { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Empty } from '@/components/ops/Empty';
import { copy } from '@/copy/copy';
import type { CustomerSummaryDto, JobDto } from '@contract';
import { ledgerApi } from '@/lib/api-ledger';
import { nodeApi } from '@/lib/api-node';
import { sloApi } from '@/lib/api-slo';
import { nowSec } from '@/lib/clock';
import { closeNodePage } from '@/lib/hash-route';
import { monthOf } from '@/lib/ledger';
import { usePrivacy } from '@/lib/privacy';
import type { FleetState } from '@/lib/use-fleet';
import { useResource } from '@/lib/use-resource';
import '@/styles/node-detail.css';
import { Timeline } from './customer/Timeline';
import { NodeAcceptance } from './node/Acceptance';
import { NodeBand } from './node/Band';
import { NodeBindings, NodeFacts, NodeQuota } from './node/Facts';
import { NodeErrors } from './node/Errors';
import { NodeHeader } from './node/Header';
import { NodeHistory, NodeReceipts } from './node/History';
import { NodeJobs } from './node/Jobs';
import { NodeJobReceipt } from './node/JobReceipt';
import { NodeLoad } from './node/Load';
import { NodeOccupants } from './node/Occupants';
import { NodePaths } from './node/Paths';
import { NodeProfileDrawer } from './node/ProfileDrawer';
import { NodeQualityBand, type QualityRange } from './node/Quality';
import { NodeQualityText } from './node/QualityText';

/**
 * The node detail page: is this machine healthy, busy and worth keeping.
 *
 * Identity and the actions first, then six headline numbers, then the
 * machine's own load, whether customers got through to it, and both
 * directions of the path — the questions in the order they get asked. Under
 * that sit who is on it, what it is complaining about and what has been done
 * to it, with the typed-in reference facts aside.
 *
 * Every block reads its own source and fails on its own: the detail carries
 * the facts and this week's errors, while load, quality, the ledger,
 * connections, jobs and history are their own requests. A jobs table that
 * could not load must not take the quota gauge down with it. The raw sweep
 * stays folded, so its kilobytes are fetched only when asked for.
 */
export default function NodeDetailPage({ name, customers, fleet }: {
  name: string;
  /** The shell's list, so a person who left this node is still named on its timeline. */
  customers: readonly CustomerSummaryDto[];
  /** The legacy read, for the hub's recent probe rounds only. */
  fleet: FleetState;
}) {
  const privacy = usePrivacy();
  const [editing, setEditing] = useState(false);
  const [range, setRange] = useState<QualityRange>('7d');
  const [startedJobs, setStartedJobs] = useState<JobDto[]>([]);
  // The week feeds the headline tiles whatever the chart shows; the month is
  // only fetched once somebody asks for it.
  const week = useResource(`node-slo-7d-${name}`, (signal) => sloApi.get({ node: name, range: '7d' }, signal));
  const month30 = useResource(
    range === '30d' ? `node-slo-30d-${name}` : null,
    (signal) => sloApi.get({ node: name, range: '30d' }, signal),
  );
  const ledgerMonth = monthOf(nowSec());
  const ledger = useResource(`ledger-month-${ledgerMonth}`, (signal) => ledgerApi.month(ledgerMonth, signal));
  const pings = useMemo(
    () => (fleet.status === 'ready' ? fleet.fleet.nodes.find((row) => row.name === name)?.agent?.carriers ?? null : null),
    [fleet, name],
  );
  const detail = useResource(name, (signal) => nodeApi.detail(name, signal));
  const acceptance = useResource(name, (signal) => nodeApi.acceptance(name, signal));
  const connections = useResource(name, (signal) => nodeApi.connections(name, signal));
  const jobs = useResource(name, (signal) => nodeApi.jobs(name, signal));
  const history = useResource(name, (signal) => nodeApi.history(name, signal));
  const receipts = useResource(name, (signal) => nodeApi.receipts(name, signal));

  if (detail.status !== 'ready') {
    return (
      <div className="page-wrap">
        <BackLink />
        <Empty message={detail.status === 'loading' ? copy.loading : detail.message || copy.loadError} />
      </div>
    );
  }

  const node = detail.data;

  return (
    <div className="page-wrap node-detail-page">
      <BackLink />

      <section className="node-hero-card raised" aria-label={node.name}>
        <NodeHeader
          node={node}
          sheet={acceptance}
          onJobQueued={(job) => setStartedJobs((current) => [job, ...current.filter((row) => row.id !== job.id)])}
          onChanged={() => {
            detail.reload();
            acceptance.reload();
            jobs.reload();
            history.reload();
            receipts.reload();
          }}
        />
      </section>

      {startedJobs.filter((job) => job.subjectType === 'node' && job.subjectId === name).map((job) => (
        <NodeJobReceipt key={job.id} nodeName={name} initialJob={job} onChanged={() => {
          detail.reload();
          acceptance.reload();
          jobs.reload();
          history.reload();
          receipts.reload();
        }} />
      ))}

      <NodeAcceptance sheet={acceptance} lifecycle={node.lifecycle} />

      <NodeBand node={node} slo={week} month={ledger} />
      <NodeLoad name={name} />
      <NodeQualityBand slo={range === '7d' ? week : month30} range={range} onRange={setRange} />
      <NodePaths forward={node.forwardPath} back={node.returnPath} pings={pings} />

      {/* Evidence reads down the main column; the narrow reference sections
          sit aside. DOM order is unchanged, so the phone keeps the question
          order and the desktop grid places explicitly. */}
      <div className="node-detail-grid">
        <div className="node-aux-card raised">
          <NodeFacts facts={node.facts} onEdit={() => setEditing(true)} />
          <NodeBindings bindings={node.bindings} />
          <NodeQuota quota={node.quota} name={name} />
        </div>

        <div className="node-detail-main raised">
          <NodeOccupants occupancy={node.occupancy} />
          <NodeErrors name={name} recent={node.recentErrors} />

          <Timeline
            title={copy.nodeSections.connections}
            emptyMessage={copy.nodeNoConnections}
            events={connections.status === 'ready' ? connections.data.items : []}
            who={(userId) => {
              const hit = node.occupancy.value.find((row) => row.userId === userId)
                ?? customers.find((row) => row.userId === userId);
              return hit ? privacy.email(hit.email) : null;
            }}
            state={connections.status}
            message={connections.status === 'error' ? connections.message : undefined}
          />

          <NodeJobs
            rows={jobs.status === 'ready' ? jobs.data.items : []}
            state={jobs.status}
            message={jobs.status === 'error' ? jobs.message : undefined}
            onChanged={jobs.reload}
          />

          <NodeHistory
            rows={history.status === 'ready' ? history.data.items : []}
            state={history.status}
            message={history.status === 'error' ? history.message : undefined}
          />
          <NodeReceipts
            rows={receipts.status === 'ready' ? receipts.data.items : []}
            state={receipts.status}
            message={receipts.status === 'error' ? receipts.message : undefined}
          />
          <NodeQualityText name={name} />
        </div>
      </div>

      {/* The write lands on the profile, and the profile is half of the page's
          own facts and the whole of its quota — so the page re-reads rather
          than patching the copy it is holding. */}
      <NodeProfileDrawer
        node={node}
        open={editing}
        onClose={() => setEditing(false)}
        onSaved={detail.reload}
      />
    </div>
  );
}

function BackLink() {
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 self-start text-micro text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      onClick={closeNodePage}
    >
      <ArrowLeft size={12} strokeWidth={1.75} />
      {copy.pages.nodes}
    </button>
  );
}
