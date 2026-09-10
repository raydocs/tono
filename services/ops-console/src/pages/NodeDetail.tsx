import { ArrowLeft } from 'lucide-react';
import { Empty } from '@/components/ops/Empty';
import { copy } from '@/copy/copy';
import type { CustomerSummaryDto } from '@contract';
import { nodeApi } from '@/lib/api-node';
import { closeNodePage } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';
import { useResource } from '@/lib/use-resource';
import { Timeline } from './customer/Timeline';
import { NodeBindings, NodeFacts, NodeQuota } from './node/Facts';
import { NodeErrors } from './node/Errors';
import { NodeHeader } from './node/Header';
import { NodeHistory } from './node/History';
import { NodeJobs } from './node/Jobs';
import { NodeOccupants } from './node/Occupants';
import { NodePaths } from './node/Paths';

/**
 * The node detail page, behind the fleet drawer.
 *
 * The order is the order the questions get asked: what is this machine and is
 * it being sold, what has been written down about it, how much of the month is
 * left, can customers reach it and can it reach home, who is on it right now,
 * what is it complaining about, and only then what has been done to it.
 *
 * Four requests rather than one: the detail carries the facts and this week's
 * errors, while connections, jobs and history are their own endpoints and are
 * allowed to fail on their own. A jobs table that could not load must not take
 * the quota gauge down with it.
 */
export default function NodeDetailPage({ name, customers }: {
  name: string;
  /** The shell's list, so a person who left this node is still named on its timeline. */
  customers: readonly CustomerSummaryDto[];
}) {
  const privacy = usePrivacy();
  const detail = useResource(name, (signal) => nodeApi.detail(name, signal));
  const connections = useResource(name, (signal) => nodeApi.connections(name, signal));
  const jobs = useResource(name, (signal) => nodeApi.jobs(name, signal));
  const history = useResource(name, (signal) => nodeApi.history(name, signal));

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
    <div className="page-wrap">
      <BackLink />

      <NodeHeader
        node={node}
        onChanged={() => { detail.reload(); jobs.reload(); history.reload(); }}
      />

      <NodeFacts facts={node.facts} />
      <NodeBindings bindings={node.bindings} />
      <NodeQuota quota={node.quota} />
      <NodePaths forward={node.forwardPath} back={node.returnPath} />
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
