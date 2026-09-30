import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { LineChart } from '@proto/charts/LineChart';
import { Meter, Spark } from '@proto/charts/small';
import { Badge, Dot, Legend, PageHeader, Panel, Segmented, Stat } from '@proto/ds';
import { bytes, cny, DAY, int, ms, NOW, pct, rate, until } from '@proto/format';
import { FLEET, type FleetNode, nodeSeries, statusCounts } from '@proto/mock/fleet';
import { type Point, sumSeries } from '@proto/mock/series';
import { useProto } from '@proto/state';

type Filter = 'all' | 'problem' | 'idle';

function avg(list: Point[][]): Point[] {
  const sum = sumSeries(list);
  return sum.map((p) => ({ at: p.at, v: p.v == null ? null : p.v / list.length }));
}
function max(list: Point[][]): Point[] {
  return list[0].map((p, i) => ({ at: p.at, v: Math.max(...list.map((s) => s[i]?.v ?? 0)) }));
}

const live = FLEET.filter((n) => n.name !== 'Catalog Only');

export default function Nodes() {
  const { range } = useProto();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const long = range === '7d' || range === '30d';
  const fleet = useMemo(() => ({
    cpu: live.map((n) => nodeSeries(n, 'cpu', range)),
    mem: live.map((n) => nodeSeries(n, 'mem', range)),
    load: live.map((n) => nodeSeries(n, 'load', range)),
    netIn: live.map((n) => nodeSeries(n, 'netIn', range)),
    netOut: live.map((n) => nodeSeries(n, 'netOut', range)),
  }), [range]);
  const counts = statusCounts();
  const rows = FLEET.filter((n) => (filter === 'all' ? true : filter === 'problem' ? n.status === 'sev' || n.status === 'warn' : n.status === 'idle'))
    .filter((n) => !q || `${n.name} ${n.city} ${n.provider} ${n.ipMasked}`.toLowerCase().includes(q.toLowerCase()));
  const users = FLEET.reduce((a, n) => a + n.users, 0);
  const month = FLEET.reduce((a, n) => a + n.monthBytes, 0);
  const cost = FLEET.reduce((a, n) => a + n.costMinor, 0);

  return (
    <div>
      <PageHeader title="节点" description="机器健不健康、忙不忙、值不值。资源来自节点探针，三网来自大陆探针。" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="节点" value={`${FLEET.length - counts.idle} / ${FLEET.length}`} sub={`在售 ${FLEET.filter((n) => n.listed).length} · 闲置 ${counts.idle}`} />
        <Stat label="有问题" value={String(counts.sev + counts.warn)} tone={counts.sev ? 'sev' : 'warn'} sub={`严重 ${counts.sev} · 注意 ${counts.warn}`} />
        <Stat label="在线客户" value={int(users)} sub="容量 170" />
        <Stat label="本月流量" value={bytes(month)} sub="计费以 usage_report_sources 为准" />
        <Stat label="月成本" value={cny(cost * 7.1)} sub="按实时汇率折人民币" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        <Panel title="CPU" description="全机队平均与最忙的一台" source="operations_agent_samples">
          <LineChart height={140} longRange={long} format={(v) => pct(v, 0)} domain={[0, 1]}
            series={[{ name: '平均', color: 'var(--c1)', points: avg(fleet.cpu), area: true }, { name: '最高', color: 'var(--c4)', points: max(fleet.cpu), dashed: true }]} />
        </Panel>
        <Panel title="内存" source="operations_agent_samples">
          <LineChart height={140} longRange={long} format={(v) => pct(v, 0)} domain={[0, 1]}
            series={[{ name: '平均', color: 'var(--c2)', points: avg(fleet.mem), area: true }, { name: '最高', color: 'var(--c4)', points: max(fleet.mem), dashed: true }]} />
        </Panel>
        <Panel title="负载 load1" source="operations_agent_samples">
          <LineChart height={140} longRange={long} format={(v) => v.toFixed(1)}
            series={[{ name: '平均', color: 'var(--c3)', points: avg(fleet.load), area: true }, { name: '最高', color: 'var(--c4)', points: max(fleet.load), dashed: true }]} />
        </Panel>
        <Panel title="流量" description="全机队合计" source="operations_agent_samples">
          <LineChart height={140} longRange={long} format={rate}
            series={[{ name: '出', color: 'var(--c1)', points: sumSeries(fleet.netOut), area: true }, { name: '入', color: 'var(--c2)', points: sumSeries(fleet.netIn) }]} />
        </Panel>
      </div>
      <div className="mt-2"><Legend items={[{ label: '平均 / 合计', color: 'var(--c1)' }, { label: '最高的一台', color: 'var(--c4)', dashed: true }]} /></div>

      <Panel className="mt-4" flush source="operations_live_snapshot" ageMin={2}
        title={<Segmented<Filter> value={filter} onChange={setFilter} options={[
          { value: 'all', label: '全部', count: FLEET.length }, { value: 'problem', label: '有问题', count: counts.sev + counts.warn }, { value: 'idle', label: '闲置', count: counts.idle },
        ]} />}
        actions={(
          <label className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-muted">
            <Search size={12} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="名称 / 城市 / 商家 / IP" className="w-40 bg-transparent outline-none" />
          </label>
        )}>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>节点</th><th>状态</th><th className="r">在线</th><th>CPU · 24h</th><th className="r">内存</th><th className="r">负载</th><th className="r">当前流量</th><th>本月流量</th><th className="r">三网 p50</th><th className="r">成功率</th><th className="r">到期</th></tr></thead>
            <tbody>{rows.map((n) => <NodeRow key={n.name} n={n} />)}</tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function NodeRow({ n }: { n: FleetNode }) {
  const lat = n.carriers.map((c) => c.latency).filter((v): v is number => v != null);
  return (
    <tr data-href onClick={() => { window.location.hash = `/nodes/${encodeURIComponent(n.name)}`; }}>
      <td>
        <div className="flex items-center gap-2"><Dot tone={n.status} pulse={n.status === 'sev'} /><span className="font-medium">{n.name}</span>{n.hy2 && <span className="text-2xs text-faint">hy2</span>}</div>
        <div className="pl-4 text-xs text-faint">{n.city} · {n.provider} · <span className="num">{n.ipMasked}</span></div>
      </td>
      <td>{n.status === 'ok' ? <span className="text-muted">正常</span> : <Badge tone={n.status}>{n.reason}</Badge>}</td>
      <td className="r num">{n.users}<span className="text-faint">/{n.capacity}</span></td>
      <td><span className="inline-flex items-center gap-2"><Spark points={nodeSeries(n, 'cpu', '24h')} width={72} height={18} domain={[0, 1]} /><span className="w-9 text-right text-xs num">{pct(n.cpu, 0)}</span></span></td>
      <td className="r num">{pct(n.mem, 0)}</td>
      <td className="r num">{n.load.toFixed(2)}</td>
      <td className="r num text-muted">{rate(n.netOut)}</td>
      <td><span className="inline-flex items-center gap-2"><Meter value={n.monthBytes / n.quotaBytes} width={56} /><span className="text-xs num text-muted">{bytes(n.monthBytes)}</span></span></td>
      <td className={`r num ${lat.length === 0 ? 'text-sev' : ''}`}>{lat.length ? ms(Math.min(...lat)) : '不通'}</td>
      <td className="r num">{pct(n.success)}</td>
      <td className={`r ${n.renewAt - NOW < 7 * DAY ? 'text-warn' : 'text-muted'}`}>{until(n.renewAt)}</td>
    </tr>
  );
}
