import { Users } from 'lucide-react';
import { LineChart } from '@proto/charts/LineChart';
import { Badge, Button } from '@proto/ds';
import { Drawer, KV, Section } from '@proto/ds/overlay';
import { int, ms, pct, time } from '@proto/format';
import { breakdown, CODE_ADVICE, failureSamples } from '@proto/mock/details';
import { CODE_TEXT, FAILURE_CODES } from '@proto/mock/observe';
import { rowProps } from '@proto/keys';
import { go } from '@proto/state';

function Split({ title, rows, total }: { title: string; rows: { label: string; count: number }[]; total: number }) {
  return (
    <div>
      <div className="mb-1.5 text-xs text-muted">{title}</div>
      <ul className="flex flex-col gap-1.5">
        {rows.slice(0, 4).map((r) => (
          <li key={r.label} className="grid grid-cols-[1fr_64px_32px] items-center gap-2 text-xs">
            <span className="truncate">{r.label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-hover"><span className="block h-full rounded-full bg-sev/70" style={{ width: `${(r.count / total) * 100}%` }} /></span>
            <span className="text-right num text-muted">{pct(r.count / total, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One failure code: what it means, where it clusters, the latest rows behind it. */
export function FailureDrawer({ code, onClose }: { code: string | null; onClose: () => void }) {
  const f = FAILURE_CODES.find((x) => x.code === code);
  const samples = code ? failureSamples(code) : [];
  return (
    <Drawer open={!!f} onOpenChange={(v) => { if (!v) onClose(); }} wide
      title={<span className="num">{code}</span>}
      subtitle={f ? `${CODE_TEXT[f.code]} · 阶段：${f.stage}` : undefined}
      meta={f && <><Badge tone="sev">{int(f.count)} 次</Badge><Badge>{f.users} 位客户</Badge><Badge>占失败 {pct(f.share, 0)}</Badge></>}
      footer={<>
        <Button icon={<Users size={14} />} onClick={() => { onClose(); go('/customers?filter=failing'); }}>看这些客户</Button>
        {f && f.topNode !== '—' && <Button variant="primary" onClick={() => { onClose(); go(`/nodes/${encodeURIComponent(f.topNode)}`); }}>去 {f.topNode}</Button>}
      </>}>
      {f && <>
        <Section title="怎么判断">
          <p className="text-sm leading-6">{CODE_ADVICE[f.code]}</p>
        </Section>
        <Section title="过去 24 小时">
          <LineChart height={120} format={(v) => v.toFixed(0)} integer series={[{ name: '每 15 分钟', color: 'var(--sev)', points: f.trend, area: true }]} />
        </Section>
        <Section title="集中在哪">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Split title="节点" rows={breakdown(samples, (s) => s.node)} total={samples.length} />
            <Split title="客户端" rows={breakdown(samples, (s) => `${s.customer.platform} ${s.customer.version}`)} total={samples.length} />
            <Split title="运营商（到 Cloudflare 一段）" rows={breakdown(samples, (s) => s.carrier)} total={samples.length} />
          </div>
        </Section>
        <Section title={`最近 ${samples.length} 条`}>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="tbl">
              <thead><tr><th>时间</th><th>客户</th><th>节点</th><th>客户端</th><th className="r">耗时</th></tr></thead>
              <tbody>{samples.map((s) => (
                <tr key={s.eventId} {...rowProps(() => { onClose(); go(`/customers/${s.customer.id}`); }, `${s.customer.email} ${time(s.at)}`)}>
                  <td className="num text-xs text-muted">{time(s.at)}</td>
                  <td className="max-w-44 truncate">{s.customer.email}</td>
                  <td className="text-muted">{s.node}</td>
                  <td className="text-muted">{s.customer.platform} {s.customer.version}</td>
                  <td className="r num text-xs">{ms(s.elapsed)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="mt-3"><KV rows={[['核心报错', <code key="e" className="num text-xs">{samples[0]?.error}</code>], ['数据源', 'connection_events · 不含主机名与目的地址']]} /></div>
        </Section>
      </>}
    </Drawer>
  );
}
