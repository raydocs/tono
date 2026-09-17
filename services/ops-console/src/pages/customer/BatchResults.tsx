import { useSyncExternalStore } from 'react';
import { Action, ActionRow } from '@/components/ops/Action';
import { batchCopy as words } from '@/copy/batch';
import { batchSnapshot, dismissBatch, inspectBatch, retryBatch, subscribeBatch } from '@/lib/customer-batch';
import { formatWhen } from '@/lib/display';
import { openCustomer } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';
import { useAsk } from './ask';

export function BatchResults({ onChanged }: { onChanged: () => void }) {
  const batch = useSyncExternalStore(subscribeBatch, batchSnapshot);
  const privacy = usePrivacy();
  const ask = useAsk(onChanged);
  if (batch.kind === null) return null;
  const count = (status: string) => batch.items.filter((item) => item.status === status).length;
  const retries = batch.items.filter((item) => item.status === 'failed' && item.retryable).length;
  const inspectable = batch.items.some((item) => ['submitted', 'delivered', 'unknown'].includes(item.status)
    && (item.operation === 'renew' || item.receiptId));

  return (
    <section className="batch-results rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] p-4" aria-label={words.title}>
      <h2 className="text-row">{words.title} · {words[batch.kind]}</h2>
      <p className="mt-2 text-body" role="status">
        {words.summary(count('done'), count('submitted') + count('delivered'), count('failed'), count('unknown'))}
      </p>
      <p className="mt-1 text-body text-[var(--muted-foreground)]">{words.safety}</p>
      <ul className="my-3 flex max-h-[420px] flex-col overflow-auto">
        {batch.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-start gap-2 border-b border-[var(--hairline)] py-3" data-batch-id={item.id}>
            <div className="min-w-0 flex-1 basis-48 break-words text-body">
              <p>{privacy.email(item.email)}{item.deviceName ? ` · ${item.deviceName}` : ''}</p>
              <p className="mt-1 font-medium">{words.states[item.status]}</p>
              {item.note ? <p className="text-[var(--muted-foreground)]">{item.note}</p> : null}
              {item.targetExpiry === undefined ? null : <p>{words.targetExpiry} · {formatWhen(item.targetExpiry)}</p>}
              {item.receiptId ? <p className="font-mono text-micro break-all">{words.receipt} · {item.receiptId}</p> : null}
            </div>
            <Action onClick={() => openCustomer(item.userId)}>{words.openCustomer}</Action>
          </li>
        ))}
      </ul>
      <ActionRow>
        {retries === 0 ? null : (
          <Action pending={batch.busy || ask.busy} onClick={() => ask.ask({
            title: words.retry, consequence: words.retryBody(retries), confirm: words.retry,
            run: retryBatch,
          })}>{words.retry}</Action>
        )}
        {inspectable ? <Action pending={batch.busy || ask.busy} onClick={() => { void inspectBatch().then(onChanged); }}>{words.inspect}</Action> : null}
        <Action pending={batch.busy || ask.busy} onClick={dismissBatch}>{words.dismiss}</Action>
      </ActionRow>
      <p className="mt-2 text-micro normal-case tracking-normal text-[var(--muted-foreground)]">{words.lifetime}</p>
      {ask.dialog}
    </section>
  );
}
