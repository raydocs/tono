import { ArrowLeft, Power, RefreshCcw, Search } from 'lucide-react';
import { LineChart } from '@proto/charts/LineChart';
import { Badge, Button, Dot, Empty, PageHeader, Panel, Stat } from '@proto/ds';
import { ago, bytes, cny, ms, NOW, pct, rate, until } from '@proto/format';
import { CUSTOMERS } from '@proto/mock/customers';
import { nodeByName, nodeSeries } from '@proto/mock/fleet';
import { useProto } from '@proto/state';

export default function NodeDetail({ name }: { name: string }) {
  const { range } = useProto();
  const n = nodeByName(name);
  if (!n) return <Empty title="没有这台节点" hint={name} action={<Button href="#/nodes">回到节点</Button>} />;
  const long = range === '7d' || range === '30d';
  const users = CUSTOMERS.filter((c) => c.node === n.name);

  return (
    <div>
      <a href="#/nodes" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-fg"><ArrowLeft size={12} /> 节点</a>
      <PageHeader
        title={n.name}
        description={<span className="inline-flex flex-wrap items-center gap-2"><Dot tone={n.status} /> {n.reason ?? '正常'} · {n.city} · {n.provider} · <span className="num">{n.ipMasked}</span> · Xray {n.xray}{n.listed ? '' : ' · 已下架'}</span>}
        actions={<>
          <Button size="sm" icon={<Search size={14} />}>重新探测</Button>
          <Button size="sm" icon={<RefreshCcw size={14} />}>重启 Xray</Button>
          <Button size="sm" variant="danger" icon={<Power size={14} />}>下架预览</Button>
        </>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="在线客户" value={`${n.users}/${n.capacity}`} />
        <Stat label="连接成功率" value={pct(n.success)} tone={n.status === 'sev' ? 'sev' : undefined} />
        <Stat label="握手 p50" value={ms(n.p50)} />
        <Stat label="本月流量" value={bytes(n.monthBytes)} sub={`配额 ${bytes(n.quotaBytes)}`} />
        <Stat label="月租" value={cny(n.costMinor * 7.1)} sub={`$${n.costMinor / 100}`} />
        <Stat label="到期" value={until(n.renewAt)} tone={n.renewAt - NOW < 7 * 86_400_000 ? 'warn' : undefined} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="CPU" source="operations_agent_samples"><LineChart height={150} longRange={long} domain={[0, 1]} format={(v) => pct(v, 0)} series={[{ name: 'CPU', color: 'var(--c1)', points: nodeSeries(n, 'cpu', range), area: true }]} guides={[{ value: 0.8, label: '80%', tone: 'warn' }]} /></Panel>
        <Panel title="内存与负载" source="operations_agent_samples"><LineChart height={150} longRange={long} domain={[0, 1]} format={(v) => pct(v, 0)} series={[{ name: '内存', color: 'var(--c2)', points: nodeSeries(n, 'mem', range), area: true }]} /></Panel>
        <Panel title="流量" source="operations_agent_samples"><LineChart height={150} longRange={long} format={rate} series={[{ name: '出', color: 'var(--c1)', points: nodeSeries(n, 'netOut', range), area: true }, { name: '入', color: 'var(--c2)', points: nodeSeries(n, 'netIn', range) }]} /></Panel>
        <Panel title="在线人数" source="ops_device_status"><LineChart height={150} longRange={long} format={(v) => v.toFixed(0)} integer series={[{ name: '在线', color: 'var(--c3)', points: nodeSeries(n, 'users', range), area: true }]} /></Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="大陆三网" description="hub 探针，每 5 分钟" source="hub collect.py" ageMin={6} flush>
          <table className="tbl">
            <thead><tr><th>运营商</th><th className="r">延迟</th><th className="r">丢包</th></tr></thead>
            <tbody>{n.carriers.map((c) => (
              <tr key={c.name}><td>{c.name}</td><td className={`r num ${c.latency == null ? 'text-sev' : ''}`}>{c.latency == null ? '不通' : ms(c.latency)}</td><td className={`r num ${(c.loss ?? 0) > 0.05 ? 'text-warn' : 'text-muted'}`}>{pct(c.loss)}</td></tr>
            ))}</tbody>
          </table>
        </Panel>
        <Panel title="最近连这台的客户" source="ops_device_status" flush>
          {users.length === 0 ? <Empty title="现在没人在用" /> : (
            <table className="tbl">
              <thead><tr><th>客户</th><th>客户端</th><th className="r">最后心跳</th></tr></thead>
              <tbody>{users.slice(0, 8).map((c) => (
                <tr key={c.id} data-href onClick={() => { window.location.hash = `/customers/${c.id}`; }}><td>{c.email}</td><td className="text-muted">{c.platform} {c.version}</td><td className="r text-muted">{c.lastSeen ? ago(c.lastSeen) : '—'}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Panel>
        <Panel title="最近的操作" source="ops_node_jobs" flush>
          <ul className="divide-y divide-line text-sm">
            {[
              ['探测', '三网全部超时', 'sev', 14], ['重启 Xray', '完成，4 秒', 'ok', 95], ['同步身份', '26 个账号', 'ok', 1440], ['发布目录', 'r40 上架', 'ok', 4300],
            ].map(([what, res, tone, min]) => (
              <li key={what as string} className="flex items-center gap-3 px-4 py-2.5"><Badge tone={tone as 'ok'}>{what}</Badge><span className="flex-1 text-muted">{res}</span><span className="text-xs text-faint">{ago(NOW - (min as number) * 60_000)}</span></li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
