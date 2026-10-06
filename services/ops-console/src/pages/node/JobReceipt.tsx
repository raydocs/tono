import { useEffect, useRef, useState } from 'react';
import type { ChangeReceiptDto, JobDto } from '@contract';
import { Action } from '@/components/ops/Action';
import { copy } from '@/copy/copy';
import { SessionExpiredError } from '@/lib/api';
import { nodeApi } from '@/lib/api-node';
import { nowSec } from '@/lib/clock';
import { formatWhenAgo } from '@/lib/display';
import { receiptSentence } from '@/lib/receipts';

const words = copy.nodeJobReceipt;
const RECEIPT_TYPES = new Set(['catalog_retire', 'catalog_relist']);
type Snapshot = {
  job: JobDto;
  receipt: ChangeReceiptDto | null;
  checkedAt: number | null;
  problem: string | null;
  unknown: boolean;
  checking: boolean;
  paused: boolean;
};

export function NodeJobReceipt({ nodeName, initialJob, onChanged }: {
  nodeName: string;
  initialJob: JobDto;
  onChanged: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    job: initialJob, receipt: null, checkedAt: null, problem: null,
    unknown: false, checking: false, paused: false,
  });
  const [refresh, setRefresh] = useState(0);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let failures = 0;
    let receiptReads = 0;
    let notified = false;

    async function read() {
      setSnapshot((current) => ({ ...current, checking: true, paused: false }));
      let jobRead = false;
      try {
        const list = await nodeApi.jobs(nodeName, controller.signal);
        const job = list.items.find((row) => row.id === initialJob.id
          && row.subjectType === 'node' && row.subjectId === nodeName);
        if (!job) throw new Error(words.missing);
        if (cancelled) return;
        jobRead = true;
        const active = job.status === 'queued' || job.status === 'leased';
        setSnapshot((current) => ({
          ...current, job, checkedAt: nowSec(), problem: null, unknown: false,
        }));
        if (!active && !notified) {
          notified = true;
          changed.current();
        }

        let receipt: ChangeReceiptDto | null = null;
        const needsReceipt = job.status === 'succeeded' && RECEIPT_TYPES.has(job.type);
        if (needsReceipt) {
          const receipts = await nodeApi.receipts(nodeName, controller.signal);
          receipt = receipts.items.find((row) => row.jobId === job.id
            && row.subjectType === 'node' && row.subjectId === nodeName && row.kind === job.type) ?? null;
          receiptReads += 1;
        }
        if (cancelled) return;
        failures = 0;
        const waiting = needsReceipt && receipt === null;
        setSnapshot((current) => ({
          ...current, receipt, checking: false,
          problem: waiting ? words.receiptMissing : null,
          paused: waiting && receiptReads >= 12,
        }));
        if (active || (waiting && receiptReads < 12)) timer = setTimeout(() => { void read(); }, 5_000);
      } catch (error) {
        if (cancelled) return;
        failures += 1;
        const paused = failures >= 3 || error instanceof SessionExpiredError;
        setSnapshot((current) => ({
          ...current, checking: false, unknown: !jobRead, paused,
          problem: error instanceof SessionExpiredError ? copy.sessionExpired : jobRead ? words.receiptFailed
            : error instanceof Error && error.message === words.missing ? words.missing : words.readFailed,
        }));
        if (!paused) timer = setTimeout(() => { void read(); }, 15_000);
      }
    }

    void read();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [nodeName, initialJob.id, refresh]);

  return (
    <section className="rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] p-4" aria-label={words.title} data-job-id={initialJob.id}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-row">{words.title} · {copy.nodeJobType[snapshot.job.type]}</h2>
        <Action pending={snapshot.checking} onClick={() => setRefresh((n) => n + 1)}>{words.refresh}</Action>
      </div>
      <div className="mt-2 text-body" role="status">
        <p className="font-medium">{snapshot.unknown ? words.unknown : words.states[snapshot.job.status]}</p>
        {snapshot.unknown ? <p>{words.lastKnown} · {words.states[snapshot.job.status]}</p> : null}
        {snapshot.job.resultSummary ? <p className="mt-1 break-words">{snapshot.job.resultSummary}</p> : null}
        {snapshot.problem ? <p className="mt-1">{snapshot.problem}</p> : null}
        {snapshot.receipt ? <p className="mt-1">{snapshot.problem ? `${words.lastKnown} · ` : ''}{receiptSentence(snapshot.receipt)}</p> : null}
        {snapshot.paused ? <p className="mt-1">{words.paused}</p> : null}
        {snapshot.job.status === 'succeeded' && !RECEIPT_TYPES.has(snapshot.job.type) ? <p className="mt-1">{words.noReceipt}</p> : null}
      </div>
      <p className="mt-2 break-all font-mono text-fine">{words.id} · {initialJob.id}</p>
      {snapshot.checkedAt === null ? null : <p className="mt-1 text-fine">{words.checked} · {formatWhenAgo(snapshot.checkedAt)}</p>}
      <p className="mt-2 text-fine text-[var(--muted-foreground)]">{words.safety}</p>
    </section>
  );
}
