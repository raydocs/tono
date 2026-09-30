import { useState } from 'react';
import { Download, Search, UserPlus } from 'lucide-react';
import { Bars, Meter } from '@proto/charts/small';
import { Badge, Button, Dot, Legend, PageHeader, Panel, Segmented, Stat, type Tone } from '@proto/ds';
import { ago, bytes, DAY, NOW, pct, time, until } from '@proto/format';
import { CUSTOMERS, type Customer, type CustomerState, customerUsage } from '@proto/mock/customers';
import { timeline } from '@proto/mock/series';

const USAGE_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c6)'];

export const STATE: Record<CustomerState, { label: string; tone: Tone }> = {
  online: { label: '在线', tone: 'ok' },
  failing: { label: '连不上', tone: 'sev' },
  offline: { label: '离线', tone: 'idle' },
  never: { label: '没连上过', tone: 'info' },
  expired: { label: '已到期', tone: 'warn' },
  disabled: { label: '已停用', tone: 'idle' },
};

type Filter = 'all' | CustomerState | 'expiring';
const PAGE = 20;

export default function Customers() {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const count = (s: CustomerState) => CUSTOMERS.filter((c) => c.state === s).length;
  const expiring = (c: Customer) => c.expiresAt > NOW && c.expiresAt - NOW < 7 * DAY;
  const rows = CUSTOMERS
    .filter((c) => (filter === 'all' ? true : filter === 'expiring' ? expiring(c) : c.state === filter))
    .filter((c) => !q || `${c.email} ${c.wechat ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);

  const top = [...CUSTOMERS].sort((a, b) => b.usageBytes - a.usageBytes).slice(0, 4);
  const hours = timeline('24h').filter((_, i) => i % 4 === 0);
  const usage = top.map((c) => customerUsage(c, '24h'));
  const bars = hours.map((at, h) => {
    const byTop = usage.map((u) => u.slice(h * 4, h * 4 + 4).reduce((a, p) => a + (p.v ?? 0), 0));
    return { label: h % 3 === 0 ? time(at).slice(0, 2) : '', values: [...byTop, byTop.reduce((a, b) => a + b, 0) * 1.8] };
  });

  return (
    <div>
      <PageHeader title="客户" description="谁在用、谁连不上、谁快到期。点一行看这位客户的完整时间线。"
        actions={<><Button icon={<Download size={14} />}>导出 CSV</Button><Button variant="primary" icon={<UserPlus size={14} />}>开通客户</Button></>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="客户" value={String(CUSTOMERS.length)} sub="含停用与到期" />
        <Stat label="在线" value={String(count('online'))} tone="ok" />
        <Stat label="连不上" value={String(count('failing'))} tone="sev" href="#/" />
        <Stat label="开通没连上过" value={String(count('never'))} tone="info" />
        <Stat label="7 天内到期" value={String(CUSTOMERS.filter(expiring).length)} tone="warn" />
        <Stat label="本月用量" value={bytes(CUSTOMERS.reduce((a, c) => a + c.usageBytes, 0))} sub="以计费源为准" />
      </div>

      <Panel className="mt-4" title="每小时用量" description="用量最大的 4 位客户与其余合计 · 过去 24 小时" source="operations_user_usage_hours" ageMin={55} staleAfter={90}>
        <Legend items={[...top.map((c) => c.email), '其他客户'].map((label, i) => ({ label, color: USAGE_COLORS[i] }))} />
        <div className="mt-2"><Bars height={150} data={bars} names={[...top.map((c) => c.email), '其他客户']} colors={USAGE_COLORS} format={bytes} /></div>
      </Panel>

      <Panel className="mt-4" flush source="ops_customer_status"
        title={<div className="flex flex-wrap gap-2"><Segmented<Filter> value={filter} onChange={(v) => { setFilter(v); setPage(0); }} options={[
          { value: 'all', label: '全部', count: CUSTOMERS.length },
          { value: 'failing', label: '连不上', count: count('failing') },
          { value: 'online', label: '在线', count: count('online') },
          { value: 'never', label: '没连上过', count: count('never') },
          { value: 'expiring', label: '快到期', count: CUSTOMERS.filter(expiring).length },
          { value: 'expired', label: '已到期', count: count('expired') },
        ]} /></div>}
        actions={(
          <label className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-muted">
            <Search size={12} /><input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="邮箱 / 微信号" className="w-36 bg-transparent outline-none" />
          </label>
        )}>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>客户</th><th>状态</th><th>客户端</th><th>节点</th><th className="r">最后在线</th><th className="r">成功率 24h</th><th>用量</th><th className="r">到期</th><th>附加</th></tr></thead>
            <tbody>{shown.map((c) => (
              <tr key={c.id} data-href onClick={() => { window.location.hash = `/customers/${c.id}`; }}>
                <td><div className="font-medium">{c.email}</div><div className="text-xs text-faint">{c.wechat ?? '没留微信'}</div></td>
                <td><span className="inline-flex items-center gap-1.5"><Dot tone={STATE[c.state].tone} />{STATE[c.state].label}</span></td>
                <td className="text-muted">{c.platform} {c.version}{c.catalogBehind && <Badge tone="warn">目录落后</Badge>}</td>
                <td className={c.state === 'failing' ? 'text-sev' : 'text-muted'}>{c.node ?? '—'}</td>
                <td className="r text-muted">{c.lastSeen ? ago(c.lastSeen) : '从未'}</td>
                <td className={`r num ${c.success24h != null && c.success24h < 0.9 ? 'text-sev' : ''}`}>{pct(c.success24h)}</td>
                <td><span className="inline-flex items-center gap-2"><Meter value={c.quotaBytes ? c.usageBytes / c.quotaBytes : null} width={56} /><span className="text-xs num text-muted">{bytes(c.usageBytes)}{c.quotaBytes ? ` / ${bytes(c.quotaBytes)}` : ''}</span></span></td>
                <td className={`r ${c.expiresAt < NOW ? 'text-sev' : c.expiresAt - NOW < 7 * DAY ? 'text-warn' : 'text-muted'}`}>{until(c.expiresAt)}</td>
                <td className="space-x-1">{c.residential && <Badge tone="info">家宽</Badge>}{c.claude && <Badge>Claude</Badge>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <footer className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-muted">
          <span>第 {rows.length === 0 ? 0 : page * PAGE + 1}–{Math.min(rows.length, (page + 1) * PAGE)} 位，共 {rows.length} 位 · 服务端游标分页，不设上限</span>
          <span className="flex gap-1">
            <Button size="xs" onClick={() => setPage(Math.max(0, page - 1))}>上一页</Button>
            <Button size="xs" onClick={() => setPage((page + 1) * PAGE < rows.length ? page + 1 : page)}>下一页</Button>
          </span>
        </footer>
      </Panel>
    </div>
  );
}
