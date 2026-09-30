import { Lock, Plus } from 'lucide-react';
import { Bars } from '@proto/charts/small';
import { Badge, Button, Legend, PageHeader, Panel, Stat } from '@proto/ds';
import { cny, DAY, usd, date, dateTime, NOW, pct, until } from '@proto/format';
import { LEDGER, REVENUE_MONTHS } from '@proto/mock/business';
import { CUSTOMERS } from '@proto/mock/customers';

export default function Finance() {
  const m = REVENUE_MONTHS[REVENUE_MONTHS.length - 1];
  const cost = m.nodes + m.residential + m.claude;
  const renewals = CUSTOMERS.filter((c) => c.state !== 'disabled' && c.expiresAt > NOW - 7 * DAY && c.expiresAt < NOW + 30 * DAY).sort((a, b) => a.expiresAt - b.expiresAt);
  const pipeline = renewals.reduce((a, c) => a + c.planMinor, 0);

  return (
    <div>
      <PageHeader title="财务" description="收入按月、支出默认美元按实时汇率折算；用量计费以 usage_report_sources 为准。"
        actions={<Button variant="primary" icon={<Plus size={14} />}>记一笔</Button>} />

      <section className="mb-4 flex items-center gap-3 rounded-lg border border-warn/40 bg-warn-soft px-4 py-2.5 text-sm">
        <Lock size={15} className="text-warn" />
        <span className="flex-1">8 月还没关账。关账后该月的收入、成本和每位客户的毛利冻结，后面的补记走冲正。</span>
        <Button size="xs">查看 8 月并关账</Button>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="9 月收入" value={cny(m.revenue)} sub="比 8 月 +6.8%" />
        <Stat label="9 月成本" value={cny(cost)} sub="节点 · 家宽 · Claude" />
        <Stat label="毛利率" value={pct((m.revenue - cost) / m.revenue, 0)} tone="ok" />
        <Stat label="付费客户" value={String(CUSTOMERS.filter((c) => c.state !== 'disabled' && c.state !== 'expired').length)} sub={`已到期 ${CUSTOMERS.filter((c) => c.state === 'expired').length}`} />
        <Stat label="30 天内待续费" value={cny(pipeline)} sub={`${renewals.length} 位客户`} tone="warn" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="收入" description="过去 12 个月" source="ops_ledger_entries">
          <Bars height={170} data={REVENUE_MONTHS.map((r) => ({ label: r.label, values: [r.revenue] }))} names={['收入']} colors={['var(--c1)']} format={cny} />
        </Panel>
        <Panel title="成本构成" description="过去 12 个月" source="ops_ledger_entries · ops_node_profiles" actions={<Legend items={[{ label: '节点', color: 'var(--c2)' }, { label: '家宽', color: 'var(--c3)' }, { label: 'Claude', color: 'var(--c4)' }]} />}>
          <Bars height={170} data={REVENUE_MONTHS.map((r) => ({ label: r.label, values: [r.nodes, r.residential, r.claude] }))} names={['节点', '家宽', 'Claude']} colors={['var(--c2)', 'var(--c3)', 'var(--c4)']} format={cny} />
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel className="xl:col-span-2" title="续费" description="过去 7 天到期与未来 30 天到期" source="users.expires_at" flush>
          <div className="max-h-[420px] overflow-y-auto">
            <table className="tbl">
              <thead><tr><th>客户</th><th className="r">到期</th><th className="r">套餐</th></tr></thead>
              <tbody>{renewals.map((c) => (
                <tr key={c.id} data-href onClick={() => { window.location.hash = `/customers/${c.id}`; }}>
                  <td>{c.email}</td>
                  <td className={`r ${c.expiresAt < NOW ? 'text-sev' : c.expiresAt - NOW < 7 * DAY ? 'text-warn' : 'text-muted'}`}>{until(c.expiresAt)} <span className="text-faint">· {date(c.expiresAt)}</span></td>
                  <td className="r num">{cny(c.planMinor)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>
        <Panel className="xl:col-span-3" title="账本" description="手工记账与账单源；更正只能冲正，不能改原行" source="ops_ledger_entries" flush>
          <div className="max-h-[420px] overflow-y-auto">
            <table className="tbl">
              <thead><tr><th>时间</th><th>类型</th><th>对象</th><th>说明</th><th>来源</th><th className="r">金额</th></tr></thead>
              <tbody>{LEDGER.map((l) => (
                <tr key={l.id}>
                  <td className="text-muted">{dateTime(l.at)}</td>
                  <td><Badge tone={l.kind === '收入' ? 'ok' : l.kind === '冲正' ? 'warn' : 'idle'}>{l.kind}</Badge></td>
                  <td className="max-w-56 truncate">{l.subject}</td>
                  <td className="text-muted">{l.note}</td>
                  <td className="text-muted">{l.source}</td>
                  <td className={`r num ${l.amountMinor < 0 ? 'text-muted' : ''}`}>{l.currency === 'USD' ? usd(l.amountMinor) : cny(l.amountMinor)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
