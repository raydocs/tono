import { Badge } from '@proto/ds';
import { Code, Drawer, KV, Section } from '@proto/ds/overlay';
import { dateTime, ms } from '@proto/format';
import type { Customer, TimelineEvent } from '@proto/mock/customers';
import { CODE_ADVICE, rawEvent } from '@proto/mock/details';
import { CODE_TEXT } from '@proto/mock/observe';
import { EVENT } from './labels';

/** A timeline row opened: the readable summary first, the stored row under it. */
export function EventDrawer({ customer, event, index, onClose }: {
  customer: Customer; event: TimelineEvent | null; index: number; onClose: () => void;
}) {
  const raw = event ? rawEvent(customer, event, index) : null;
  return (
    <Drawer open={!!event} onOpenChange={(v) => { if (!v) onClose(); }}
      title={event ? (event.code ?? event.detail) : ''}
      subtitle={event ? `${dateTime(event.at)} · ${customer.email}` : undefined}
      meta={event && <Badge tone={EVENT[event.kind].tone}>{EVENT[event.kind].label}</Badge>}>
      {event && raw && <>
        <Section title="摘要">
          <KV rows={[
            ['节点', event.node ?? '—'],
            ['阶段', event.stage ?? '—'],
            ['耗时', event.elapsed ? ms(event.elapsed) : '—'],
            ['客户端', `${customer.platform} ${customer.version}`],
            ...(event.code ? [['意思', CODE_TEXT[event.code] ?? '—'] as [string, string]] : []),
          ]} />
          {event.code && <p className="mt-3 rounded-md bg-panel-2 px-3 py-2 text-xs leading-5 text-muted">{CODE_ADVICE[event.code]}</p>}
        </Section>
        <Section title="原始记录">
          <Code value={raw} label={`connection_events · ${raw.id}`} />
          <p className="mt-2 text-xs text-muted">edge_* 是客户到 Cloudflare 的一段，不是回程线路。记录里没有主机名和目的地址；那些只在 owner 打开原始日志窗口后可读。</p>
        </Section>
      </>}
    </Drawer>
  );
}
