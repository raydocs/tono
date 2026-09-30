import { useState } from 'react';
import { LineChart } from '@proto/charts/LineChart';
import { Spark } from '@proto/charts/small';
import { Badge, Dot, Legend, NotWired, PageHeader, Panel, Segmented, Stat } from '@proto/ds';
import { ago, int, ms, NOW, pct } from '@proto/format';
import { FLEET } from '@proto/mock/fleet';
import {
  AI_ROUTES, attemptsSeries, CLUSTERS, CODE_TEXT, DNS, dnsSeries, FAILURE_CODES, HOPS, hopSeries, latencySeries, SEGMENTS, successSeries,
} from '@proto/mock/observe';
import { HOUR, last } from '@proto/mock/series';
import { useProto } from '@proto/state';

type Split = 'all' | 'platform' | 'carrier';
const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)'];

export default function Observe() {
  const { range, telemetry } = useProto();
  const [split, setSplit] = useState<Split>('platform');
  const long = range === '7d' || range === '30d';
  const all = successSeries('all', range);
  const lines = split === 'all'
    ? [{ name: '全部', color: COLORS[0], points: all, area: true }]
    : SEGMENTS[split].map((s, i) => ({ name: s.label, color: COLORS[i], points: successSeries(`${split}:${s.key}`, range, s.base, s.incident) }));
  const attempts = attemptsSeries(range).reduce((a, p) => a + (p.v ?? 0), 0);
  const failures = FAILURE_CODES.reduce((a, f) => a + f.count, 0);
  const band = [{ from: NOW - 2 * HOUR - 40 * 60_000, to: NOW, tone: 'sev' as const }];

  return (
    <div>
      <PageHeader title="连接质量" description="客户能不能连上、慢在哪、为什么失败。按平台、运营商、节点拆开看。" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="连接成功率" value={pct(last(all))} tone="warn" sub="目标 99% · 过去 30 天 98.7%" />
        <Stat label="连接尝试" value={int(Math.round(attempts))} sub={`失败 ${int(failures)} 次`} />
        <Stat label="握手 p50" value={ms(last(latencySeries(range, 'p50')))} sub="客户点连接到可用" />
        <Stat label="握手 p95" value={ms(last(latencySeries(range, 'p95')))} tone="warn" sub="比昨天慢 0.8 s" />
        <Stat label="有失败的客户" value="11" sub="其中 5 位现在还连不上" tone="sev" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="成功率" source="ops_connection_daily"
          actions={<Segmented<Split> size="xs" value={split} onChange={setSplit} options={[{ value: 'all', label: '全部' }, { value: 'platform', label: '平台' }, { value: 'carrier', label: '运营商' }]} />}>
          <LineChart series={lines} format={(v) => pct(v, 0)} domain={[0.85, 1]} guides={[{ value: 0.99, label: '99%', tone: 'ok' }]} bands={band} longRange={long} height={200} />
          <div className="mt-2 flex items-center justify-between">
            <Legend items={lines.map((l) => ({ label: l.name, color: l.color }))} />
            {split === 'carrier' && <span className="text-2xs text-faint">运营商取自客户到 Cloudflare 的一跳，不是回程线路</span>}
          </div>
        </Panel>
        <Panel title="握手耗时" description="从点击连接到隧道可用" source="connection_events.elapsed_ms">
          <LineChart
            series={[
              { name: 'p50', color: 'var(--c2)', points: latencySeries(range, 'p50'), area: true },
              { name: 'p95', color: 'var(--c4)', points: latencySeries(range, 'p95'), dashed: true },
            ]}
            format={ms} bands={band} longRange={long} height={200}
          />
          <div className="mt-2"><Legend items={[{ label: 'p50', color: 'var(--c2)' }, { label: 'p95', color: 'var(--c4)', dashed: true }]} /></div>
        </Panel>
      </div>

      <Panel className="mt-4" title="失败码" description="按次数排序；点一行看这类失败的客户" source="connection_events" flush>
        <table className="tbl">
          <thead><tr><th>失败码</th><th>意思</th><th>阶段</th><th className="r">次数</th><th className="r">客户</th><th>占比</th><th>24 小时</th><th>最多的节点</th><th>最多的版本</th></tr></thead>
          <tbody>
            {FAILURE_CODES.map((f) => (
              <tr key={f.code} data-href>
                <td className="num text-xs">{f.code}</td>
                <td>{CODE_TEXT[f.code]}</td>
                <td className="text-muted">{f.stage}</td>
                <td className="r num">{int(f.count)}</td>
                <td className="r num">{f.users}</td>
                <td>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-hover"><span className="block h-full bg-sev/70" style={{ width: `${f.share * 100}%` }} /></span>
                    <span className="w-9 text-right text-xs num text-muted">{pct(f.share, 0)}</span>
                  </span>
                </td>
                <td><Spark points={f.trend} color="var(--sev)" width={88} height={20} /></td>
                <td className="text-muted">{f.topNode}</td>
                <td className="text-muted">{f.topVersion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel className="mt-4" title="每个节点" description="成功率低于 99% 的标黄，低于 95% 标红；三网延迟来自大陆探针" source="ops_daily_slo · hub 探针" ageMin={6} flush>
        <table className="tbl">
          <thead><tr><th>节点</th><th className="r">在线</th><th className="r">成功率</th><th>趋势</th><th className="r">握手 p50</th><th className="r">电信</th><th className="r">联通</th><th className="r">移动</th><th className="r">丢包</th></tr></thead>
          <tbody>
            {FLEET.filter((n) => n.success != null || n.status === 'sev').map((n) => {
              const tone = n.success == null ? 'idle' : n.success < 0.95 ? 'sev' : n.success < 0.99 ? 'warn' : 'ok';
              const loss = Math.max(...n.carriers.map((c) => c.loss ?? 0));
              return (
                <tr key={n.name} data-href onClick={() => { window.location.hash = `/nodes/${encodeURIComponent(n.name)}`; }}>
                  <td><span className="inline-flex items-center gap-2"><Dot tone={n.status} />{n.name}</span></td>
                  <td className="r num">{n.users}</td>
                  <td className={`r num ${tone === 'sev' ? 'text-sev' : tone === 'warn' ? 'text-warn' : ''}`}>{pct(n.success)}</td>
                  <td><Spark points={successSeries(`node:${n.name}`, '24h', n.success ?? 0.99, n.status === 'sev')} color={tone === 'sev' ? 'var(--sev)' : 'var(--c1)'} width={80} height={18} domain={[0.5, 1]} /></td>
                  <td className="r num">{ms(n.p50)}</td>
                  {n.carriers.map((c) => <td key={c.name} className={`r num ${c.latency == null ? 'text-sev' : ''}`}>{c.latency == null ? '不通' : ms(c.latency)}</td>)}
                  <td className={`r num ${loss > 0.05 ? 'text-warn' : 'text-muted'}`}>{pct(loss)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <div className="mt-8 mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold">客户端诊断</h2>
        <Badge tone={telemetry ? 'ok' : 'idle'}>{telemetry ? '已接入' : '依赖 #707 · 迁移 0093'}</Badge>
      </div>
      {!telemetry ? (
        <div className="flex flex-col gap-2">
          <NotWired what="每一跳的握手（入口 / 家宽）" needs="chain_hops" />
          <NotWired what="DNS 漂移与泄漏" needs="dns_checks" />
          <NotWired what="AI 服务走了哪个出口" needs="ai_service_routes" />
          <NotWired what="失败聚类" needs="failure_clusters" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Panel title="每一跳的握手" description="入口节点 → 家宽出口" source="chain_hops">
            <LineChart series={[
              { name: '入口节点 p50', color: 'var(--c2)', points: hopSeries(range, 'entry') },
              { name: '家宽出口 p50', color: 'var(--c5)', points: hopSeries(range, 'residential') },
            ]} format={ms} longRange={long} height={150} />
            <table className="tbl mt-3">
              <thead><tr><th>一跳</th><th className="r">p50</th><th className="r">p95</th><th className="r">失败率</th><th className="r">样本</th></tr></thead>
              <tbody>{HOPS.map((h) => (
                <tr key={h.role}><td>{h.role}</td><td className="r num">{ms(h.p50)}</td><td className="r num">{ms(h.p95)}</td><td className={`r num ${h.fail > 0.03 ? 'text-warn' : ''}`}>{pct(h.fail)}</td><td className="r num text-muted">{int(h.samples)}</td></tr>
              ))}</tbody>
            </table>
          </Panel>
          <Panel title="DNS" description="解析是否离开隧道、地理是否和出口一致" source="dns_checks">
            <div className="grid grid-cols-4 gap-3">
              <Stat label="检查" value={int(DNS.checks)} />
              <Stat label="隧道外解析" value={String(DNS.leakOutside)} tone="sev" />
              <Stat label="IPv6 泄漏" value={String(DNS.ipv6Leak)} tone="sev" />
              <Stat label="地理不一致" value={String(DNS.geoMismatch)} tone="warn" />
            </div>
            <div className="mt-3"><LineChart series={[{ name: '地理不一致 / 小时', color: 'var(--c4)', points: dnsSeries(range), area: true }]} format={(v) => v.toFixed(0)} longRange={long} height={110} /></div>
          </Panel>
          <Panel title="AI 服务出口" description="Claude / OpenAI 的流量走了哪类出口；只统计同意上报的设备" source="ai_service_routes">
            {AI_ROUTES.map((a) => (
              <div key={a.service} className="mb-3 last:mb-0">
                <div className="mb-1 flex items-center gap-2 text-sm"><span className="font-medium">{a.service}</span><span className="text-xs text-faint">{int(a.buckets)} 个时段</span>
                  {a.leaks > 0 && <Badge tone="sev">{a.leaks} 次走错出口</Badge>}<span className="ml-auto text-xs text-faint">切换出口 {a.switched} 次</span></div>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-hover">
                  {[['residential', 'var(--c3)'], ['datacenter', 'var(--c2)'], ['direct', 'var(--sev)'], ['unknown', 'var(--c6)']].map(([k, c]) => (
                    <span key={k} style={{ width: `${(a[k as 'residential'] as number) * 100}%`, background: c }} />
                  ))}
                </div>
              </div>
            ))}
            <Legend items={[{ label: '家宽', color: 'var(--c3)' }, { label: '机房', color: 'var(--c2)' }, { label: '直连（泄漏）', color: 'var(--sev)' }, { label: '未知', color: 'var(--c6)' }]} />
          </Panel>
          <Panel title="失败聚类" description="错误码 + 阶段 + 版本 + 节点；30 分钟没有新事件就收起" source="failure_clusters" flush>
            <table className="tbl">
              <thead><tr><th>失败码</th><th>版本</th><th>节点</th><th className="r">次数</th><th className="r">客户</th><th>最近</th><th /></tr></thead>
              <tbody>{CLUSTERS.map((c) => (
                <tr key={c.id}><td className="num text-xs">{c.code}</td><td>{c.version}</td><td className="text-muted">{c.node}</td><td className="r num">{c.events}</td><td className="r num">{c.users}</td><td className="text-muted">{ago(c.last)}</td><td><Badge tone={c.status === 'open' ? 'sev' : 'idle'}>{c.status === 'open' ? '进行中' : '已安静'}</Badge></td></tr>
              ))}</tbody>
            </table>
          </Panel>
        </div>
      )}
    </div>
  );
}
