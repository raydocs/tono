import { ArrowLeft, CalendarPlus, FileSearch, Lock, RefreshCcw, Shuffle } from 'lucide-react';
import { LineChart } from '@proto/charts/LineChart';
import { Heatmap, Meter } from '@proto/charts/small';
import { Badge, Button, Dot, Empty, PageHeader, Panel, Stat, type Tone } from '@proto/ds';
import { ago, bytes, cny, date, dateTime, DAY, HOUR, ms, NOW, pct, time, until } from '@proto/format';
import { customerById, customerTimeline, customerUsage, customerWeek, type TimelineEvent } from '@proto/mock/customers';
import { CODE_TEXT } from '@proto/mock/observe';
import { useProto } from '@proto/state';
import { STATE } from './Customers';

const EVENT: Record<TimelineEvent['kind'], { label: string; tone: Tone }> = {
  connectOk: { label: '连上', tone: 'ok' },
  connectFail: { label: '失败', tone: 'sev' },
  nodeSwitch: { label: '换节点', tone: 'info' },
  catalogSync: { label: '目录', tone: 'idle' },
  appUpdate: { label: '更新', tone: 'idle' },
  quota: { label: '额度', tone: 'warn' },
  support: { label: '客服', tone: 'info' },
};

export default function CustomerDetail({ id }: { id: string }) {
  const { range } = useProto();
  const c = customerById(id);
  if (!c) return <Empty title="没有这位客户" hint={id} action={<Button href="#/customers">回到客户</Button>} />;
  const events = customerTimeline(c);
  const days = [...new Set(events.map((e) => date(e.at)))];
  const payments = [0, 1, 2].map((k) => ({
    id: `${c.id}-p${k}`,
    at: Math.min(NOW, c.joinedAt + (2 - k) * 30 * DAY) - k * 3 * HOUR,
    note: k === 2 ? '开通 · 月付' : '续费 1 个月',
    amountMinor: c.planMinor,
  })).filter((p) => p.at >= c.joinedAt);
  const failing = c.state === 'failing';
  const claude = c.claude ? `claude-${c.id.slice(2)}` : null;

  return (
    <div>
      <a href="#/customers" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-fg"><ArrowLeft size={12} /> 客户</a>
      <PageHeader
        title={c.email}
        description={<span className="inline-flex flex-wrap items-center gap-2"><Dot tone={STATE[c.state].tone} /> {STATE[c.state].label} · {c.wechat ?? '没留微信'} · 开通于 {date(c.joinedAt)} · <span className="num text-faint">{c.id}</span></span>}
        actions={<>
          <Button icon={<CalendarPlus size={14} />}>续期</Button>
          <Button icon={<RefreshCcw size={14} />}>刷新目录</Button>
          <Button variant="danger">停用</Button>
        </>}
      />

      <section className={`mb-4 flex items-center gap-4 rounded-lg border px-4 py-3 ${failing ? 'border-sev/40 bg-sev-soft' : 'border-line bg-panel'}`}>
        <Dot tone={failing ? 'sev' : STATE[c.state].tone} pulse={failing} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{failing ? `现在连不上：${c.stateReason}` : c.state === 'online' ? `正在用 ${c.node}，一切正常` : c.stateReason ?? `离线，最后在线 ${c.lastSeen ? ago(c.lastSeen) : '—'}`}</div>
          <div className="text-xs text-muted">{failing ? '同一节点上还有 4 位客户连不上。Tokyo · Neon 空闲且三网正常。' : `客户端 ${c.platform} ${c.version} · ${c.devices} 台设备`}</div>
        </div>
        {failing && <Button variant="primary" icon={<Shuffle size={14} />}>让客户端换到 Tokyo · Neon</Button>}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="成功率 · 24h" value={pct(c.success24h)} tone={c.success24h != null && c.success24h < 0.9 ? 'sev' : undefined} />
        <Stat label="本期用量" value={bytes(c.usageBytes)} sub={c.quotaBytes ? `配额 ${bytes(c.quotaBytes)}` : '不限量'}>
          <Meter value={c.quotaBytes ? c.usageBytes / c.quotaBytes : null} width={140} />
        </Stat>
        <Stat label="到期" value={until(c.expiresAt)} sub={date(c.expiresAt)} tone={c.expiresAt < NOW ? 'sev' : undefined} />
        <Stat label="套餐" value={`${cny(c.planMinor)}/月`} sub="微信转账" />
        <Stat label="设备" value={String(c.devices)} sub="上限 3" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <Panel title="时间线" description="连接、换节点、目录与更新，按时间倒序" source="connection_events" flush>
            <div className="max-h-[520px] overflow-y-auto">
              {days.map((d) => (
                <div key={d}>
                  <div className="sticky top-0 z-1 border-b border-line bg-panel-2 px-4 py-1 text-xs font-medium text-muted">{d}</div>
                  {events.filter((e) => date(e.at) === d).map((e, i) => (
                    <div key={i} className="flex items-center gap-3 border-b border-line px-4 py-2 text-sm last:border-b-0">
                      <span className="w-11 shrink-0 text-xs num text-faint">{time(e.at)}</span>
                      <span className="w-14 shrink-0"><Badge tone={EVENT[e.kind].tone}>{EVENT[e.kind].label}</Badge></span>
                      <span className="min-w-0 flex-1 truncate">
                        {e.code ? <><span className="num text-xs">{e.code}</span> <span className="text-muted">· {CODE_TEXT[e.code] ?? ''} · {e.stage}</span></> : e.detail}
                      </span>
                      <span className="w-40 shrink-0 truncate text-right text-xs text-muted">{e.node ?? ''}</span>
                      <span className="w-14 shrink-0 text-right text-xs num text-faint">{e.elapsed ? ms(e.elapsed) : ''}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Panel>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="用量" source="operations_user_usage_hours" ageMin={55} staleAfter={90}>
              <LineChart height={140} longRange={range === '7d' || range === '30d'} format={bytes} series={[{ name: '用量', color: 'var(--c1)', points: customerUsage(c, range), area: true }]} />
            </Panel>
            <Panel title="什么时候在用" description="过去 7 天，每格一小时">
              <Heatmap rows={customerWeek(c)} rowLabels={['周四', '周五', '周六', '周日', '周一', '周二', '周三']} cell={11} />
            </Panel>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="设备" source="ops_device_status" flush>
            {Array.from({ length: c.devices }, (_, i) => (
              <div key={i} className="border-b border-line px-4 py-3 last:border-b-0">
                <div className="flex items-center gap-2 text-sm"><Dot tone={i === 0 ? STATE[c.state].tone : 'idle'} /><span className="font-medium">{i === 0 ? (c.platform === 'macOS' ? 'MacBook Pro' : 'DESKTOP-HOME') : c.platform === 'macOS' ? 'Mac mini' : 'LAPTOP-WORK'}</span><span className="ml-auto text-xs text-faint">{c.platform} {c.version}</span></div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button size="xs">诊断快照</Button><Button size="xs">刷新目录</Button><Button size="xs">重试断线保护</Button>
                </div>
              </div>
            ))}
          </Panel>
          <Panel title="家宽与 Claude">
            <dl className="grid grid-cols-[80px_1fr] gap-y-2 text-sm">
              <dt className="text-muted">家宽出口</dt><dd>{c.residential ? <a className="hover:underline" href="#/residential">{c.residential}</a> : <span className="text-faint">没有绑定</span>}</dd>
              <dt className="text-muted">Claude</dt><dd>{claude ? `已分配 ${claude}` : <span className="text-faint">没有</span>}</dd>
            </dl>
          </Panel>
          <Panel title="账务" source="ops_ledger_entries" flush>
            <table className="tbl">
              <tbody>{payments.map((p) => (
                <tr key={p.id}><td className="text-muted">{dateTime(p.at)}</td><td>{p.note}</td><td className="r num">{cny(p.amountMinor)}</td></tr>
              ))}</tbody>
            </table>
          </Panel>
          <Panel title="原始网络日志" description="只有 owner 能开；开窗、读取都写审计">
            <div className="flex items-start gap-3 text-sm">
              <Lock size={16} className="mt-0.5 text-faint" />
              <div className="flex-1 text-muted">没有打开的窗口。打开后 30 分钟内客户端上传的主机名日志可读，到期自动关闭。</div>
            </div>
            <div className="mt-3"><Button size="xs" icon={<FileSearch size={12} />}>打开 30 分钟窗口</Button></div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
