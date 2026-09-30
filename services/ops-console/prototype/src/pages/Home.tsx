import { ArrowRight, CircleHelp, ShieldAlert } from 'lucide-react';
import { LineChart } from '@proto/charts/LineChart';
import { Spark } from '@proto/charts/small';
import { Badge, Button, Dot, Legend, Panel, toneText } from '@proto/ds';
import { ago, bytes, DAY, int, ms, NOW, pct, until } from '@proto/format';
import { CUSTOMERS, customerById, onlineSeries } from '@proto/mock/customers';
import { FLEET } from '@proto/mock/fleet';
import { attemptsSeries, INCIDENTS, latencySeries, successSeries } from '@proto/mock/observe';
import { HOUR, last } from '@proto/mock/series';
import { go, useHashParam, useProto } from '@proto/state';
import { useToast } from '@proto/ds/overlay';
import { IncidentDrawer } from './home/IncidentDrawer';
import { rowProps } from '@proto/keys';

/** Chores use the Worker's thresholds, not a second client-side copy. */
const QUOTA_WARN = 0.8;
const EXPIRY_WARN_DAYS = 7;

/** Without fresh connection data the page must not claim anything is fine. */
function VerdictUnknown({ loading }: { loading: boolean }) {
  return (
    <section className="flex items-start gap-3 rounded-lg border border-line bg-panel px-5 py-4">
      <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-warn-soft text-warn"><CircleHelp size={18} /></span>
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold tracking-tight">{loading ? '正在确认用户能不能连上…' : '现在判断不了用户能不能连上'}</h1>
        {loading
          ? <div className="skeleton mt-2 h-4 w-96 max-w-full" />
          : <p className="mt-0.5 text-sm text-muted">读不到 connection_events。在它恢复前，这里不显示“一切正常”，也不显示旧数字。</p>}
      </div>
    </section>
  );
}

export function Home() {
  const { range, dataState } = useProto();
  const [incId, setIncId] = useHashParam('incident');
  const toast = useToast();
  const ok = successSeries('all', range);
  const ok1h = successSeries('all', '1h');
  const p50 = latencySeries('1h', 'p50');
  const online = onlineSeries('1h');
  const affected = [...new Set(INCIDENTS.flatMap((i) => i.affectedIds))].map((id) => customerById(id)!).filter(Boolean);
  const sev = INCIDENTS.filter((i) => i.severity === 'sev').length;
  const rateNow = last(ok1h) ?? 0;
  const expiring = CUSTOMERS.filter((c) => c.state !== 'disabled' && c.expiresAt > NOW && c.expiresAt - NOW < EXPIRY_WARN_DAYS * DAY);
  const quota = CUSTOMERS.filter((c) => c.quotaBytes && c.usageBytes / c.quotaBytes >= QUOTA_WARN);
  const never = CUSTOMERS.filter((c) => c.state === 'never');
  const tone = sev > 0 ? 'sev' : INCIDENTS.length ? 'warn' : 'ok';

  return (
    <div className="flex flex-col gap-4">
      {dataState === 'loading' || dataState === 'error' ? <VerdictUnknown loading={dataState === 'loading'} /> : (
      <section className="rounded-lg border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-6 px-5 py-4">
          <div className="flex min-w-0 flex-1 items-start gap-3 sm:min-w-72">
            <span className={`mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-md ${tone === 'sev' ? 'bg-sev-soft text-sev' : 'bg-ok-soft text-ok'}`}>
              <ShieldAlert size={18} />
            </span>
            <div>
              <h1 className={`text-xl font-semibold tracking-tight ${toneText(tone)}`}>
                {sev} 个严重故障 · {affected.length} 位客户受影响
              </h1>
              <p className="mt-0.5 text-sm text-muted">
                其余客户能正常连接。过去 1 小时成功率 <span className="num text-fg">{pct(rateNow)}</span>，比昨天同时段低 <span className="num text-fg">4.6</span> 个百分点，主要来自 Los Angeles · Mesa。
              </p>
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 lg:w-auto">
            {[
              { label: '连接成功率 · 1h', value: pct(rateNow), tone: rateNow < 0.99 ? 'warn' as const : undefined, points: ok1h, color: 'var(--c1)' },
              { label: '握手 p50 · 1h', value: ms(last(p50)), points: p50, color: 'var(--c2)' },
              { label: '在线客户', value: int(last(online)), points: online, color: 'var(--c3)' },
              { label: '受影响客户', value: String(affected.length), tone: 'sev' as const, points: null, color: '' },
            ].map((s) => (
              <div key={s.label} className="min-w-28">
                <div className="text-xs text-muted">{s.label}</div>
                <div className={`mt-0.5 text-2xl font-semibold tracking-tight num ${s.tone ? toneText(s.tone) : ''}`}>{s.value}</div>
                {s.points ? <Spark points={s.points} color={s.color} width={112} height={20} /> : <div className="h-5 text-xs text-faint">在 {INCIDENTS.length} 个事故里</div>}
              </div>
            ))}
          </div>
        </div>
      </section>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="正在发生" description="按影响排序；认领后其他人看到是谁在处理" source="ops_incidents" flush
          actions={<Button size="xs" variant="ghost" href="#/observe">看连接质量</Button>}>
          <ul className="divide-y divide-line">
            {INCIDENTS.map((inc) => (
              <li key={inc.id} className="flex flex-wrap items-start gap-3 px-4 py-3 hover:bg-hover sm:flex-nowrap">
                <span className={`mt-1 h-10 w-1 shrink-0 rounded-full ${inc.severity === 'sev' ? 'bg-sev' : 'bg-warn'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={inc.severity}>{inc.severity === 'sev' ? '严重' : '注意'}</Badge>
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => setIncId(inc.id)}>{inc.title}</button>
                  </div>
                  <div className="mt-1 text-xs text-muted">{inc.signal}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-faint">
                    <span>持续 <span className="num text-fg">{Math.round((NOW - inc.since) / 60_000)}</span> 分钟</span>
                    <span>影响 <span className="num text-fg">{inc.affected}</span> 位客户</span>
                    <span>{inc.owner ? `${inc.owner} 在处理` : '无人认领'}</span>
                    <span className="text-muted">下一步：{inc.next}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5 max-sm:ml-4">
                  {!inc.owner && <Button size="xs" onClick={() => toast(`已认领 ${inc.id}`, 'ok')}>认领</Button>}
                  <Button size="xs" variant="primary" onClick={() => setIncId(inc.id)}>处理</Button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="受影响的客户" description="现在连不上、或正卡在故障节点上" source="ops_customer_status" flush>
          <ul className="divide-y divide-line">
            {affected.map((c) => (
              <li key={c.id}>
                <a href={`#/customers/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover">
                  <Dot tone="sev" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{c.email}</div>
                    <div className="truncate text-xs text-faint">{c.stateReason ?? `卡在 ${c.node}`}</div>
                  </div>
                  <span className="text-xs text-faint">{c.platform} {c.version}</span>
                  <ArrowRight size={14} className="text-faint" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="连接成功率" description="所有客户端的连接尝试；阴影是进行中的事故" source="connection_events"
          actions={<Legend items={[{ label: '成功率', color: 'var(--c1)' }, { label: '目标 99%', color: 'var(--ok)', dashed: true }]} />}>
          <LineChart
            series={[{ name: '成功率', color: 'var(--c1)', points: ok, area: true }]}
            format={(v) => pct(v, 0)}
            domain={[0.85, 1]}
            guides={[{ value: 0.99, label: '目标 99%', tone: 'ok' }]}
            bands={[{ from: NOW - 2 * HOUR - 40 * 60_000, to: NOW, tone: 'sev' }]}
            longRange={range === '7d' || range === '30d'}
          />
          <div className="mt-3 grid grid-cols-1 gap-3 border-t sm:grid-cols-3 border-line pt-3 text-xs">
            <div><div className="text-faint">尝试</div><div className="num text-sm">{int(Math.round(attemptsSeries(range).reduce((a, p) => a + (p.v ?? 0), 0)))}</div></div>
            <div><div className="text-faint">失败最多的码</div><div className="text-sm"><span className="num">TLS_HANDSHAKE_TIMEOUT</span> · 46%</div></div>
            <div><div className="text-faint">最差的一段</div><div className="text-sm">Windows · 联通 · Mesa</div></div>
          </div>
        </Panel>

        <Panel title="节点状态" description={`${FLEET.length} 台 · 点开看详情`} source="operations_live_snapshot" ageMin={2}>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {FLEET.map((n) => (
              <a key={n.name} href={`#/nodes/${encodeURIComponent(n.name)}`} title={n.reason ?? '正常'}
                className={`group rounded-md border px-2 py-1.5 transition-colors ${n.status === 'sev' ? 'border-sev/40 bg-sev-soft' : n.status === 'warn' ? 'border-warn/40 bg-warn-soft' : 'border-line hover:bg-hover'}`}>
                <div className="flex items-center gap-1.5"><Dot tone={n.status} /><span className="truncate text-xs font-medium">{n.name.split(' · ')[1] ?? n.name}</span></div>
                <div className="mt-0.5 truncate text-2xs text-muted">{n.city} · {n.users} 人</div>
              </a>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="今天要做" description={`规则与 Worker 同一份：用量 ≥ ${QUOTA_WARN * 100}%、${EXPIRY_WARN_DAYS} 天内到期`} source="ops_customer_status" flush className="xl:col-span-2">
          <table className="tbl">
            <thead><tr><th>事项</th><th>客户</th><th className="max-md:hidden">依据</th><th className="r">期限</th><th><span className="sr-only">打开</span></th></tr></thead>
            <tbody>
              {[
                ...expiring.slice(0, 3).map((c) => ({ c, what: '到期续费', why: `套餐 ¥${c.planMinor / 100}/月`, when: until(c.expiresAt) })),
                ...quota.slice(0, 2).map((c) => ({ c, what: '用量快满', why: `${bytes(c.usageBytes)} / ${bytes(c.quotaBytes)}`, when: '本周期' })),
                ...never.slice(0, 2).map((c) => ({ c, what: '开通未连上', why: `开通 ${ago(c.joinedAt)}`, when: '尽快' })),
              ].map(({ c, what, why, when }) => (
                <tr key={`${what}${c.id}`} {...rowProps(() => go(`/customers/${c.id}`), `${what} ${c.email}`)}>
                  <td><Badge tone={what === '开通未连上' ? 'info' : 'warn'}>{what}</Badge></td>
                  <td>{c.email}</td>
                  <td className="text-muted max-md:hidden">{why}</td>
                  <td className="r text-muted">{when}</td>
                  <td className="r"><ArrowRight size={14} className="inline text-faint" aria-hidden /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="数据新鲜度" description="每个数字来自哪张表、多久前更新">
          <ul className="flex flex-col gap-2 text-xs">
            {[
              ['客户端连接事件', 'connection_events', 1, 15],
              ['节点实时快照', 'operations_live_snapshot', 2, 10],
              ['大陆三网探测', 'hub collect.py', 6, 30],
              ['节点资源采样', 'operations_agent_samples', 1, 10],
              ['家宽探测', 'operations_home_probe_samples', 12, 30],
              ['计费用量', 'usage_report_sources', 55, 90],
            ].map(([label, src, age, limit]) => (
              <li key={src as string} className="flex items-center gap-2">
                <Dot tone={(age as number) > (limit as number) ? 'warn' : 'ok'} />
                <span className="flex-1">{label}</span>
                <span className="text-faint max-sm:hidden">{src}</span>
                <span className="w-16 text-right num text-muted">{age} 分钟</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <IncidentDrawer inc={INCIDENTS.find((i) => i.id === incId)} onClose={() => setIncId(null)} />
    </div>
  );
}
