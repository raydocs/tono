import { useState } from 'react';
import { ArrowLeft, CalendarPlus, FileSearch, Lock, LockOpen, RefreshCcw, Shuffle } from 'lucide-react';
import { LineChart } from '@proto/charts/LineChart';
import { Heatmap, Meter } from '@proto/charts/small';
import { Badge, Button, Dot, Empty, PageHeader, Panel, Stat } from '@proto/ds';
import { Textarea } from '@proto/ds/forms';
import { useToast } from '@proto/ds/overlay';
import { ago, bytes, cny, date, dateTime, DAY, HOUR, ms, NOW, pct, time, until } from '@proto/format';
import { STATE } from '@proto/labels';
import { customerById, customerTimeline, customerUsage, customerWeek } from '@proto/mock/customers';
import { CODE_TEXT } from '@proto/mock/observe';
import { useHashParam, useProto } from '@proto/state';
import { DisableConfirm, LogWindowConfirm, RenewDrawer, SwitchConfirm } from './customer/Actions';
import { EventDrawer } from './customer/EventDrawer';
import { EVENT } from './customer/labels';

type Dialog = 'renew' | 'disable' | 'switch' | 'logs' | null;

export default function CustomerDetail({ id }: { id: string }) {
  const { range } = useProto();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [eventParam, setEventParam] = useHashParam('event');
  const [logUntil, setLogUntil] = useState<number | null>(null);
  const [notes, setNotes] = useState<{ at: number; who: string; text: string }[]>([{ at: NOW - 26 * HOUR, who: 'ray', text: '客户说晚上 YouTube 卡，已让他切到 Tokyo · Neon 观察。' }]);
  const [draft, setDraft] = useState('');
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
  const eventIndex = eventParam == null ? -1 : Number(eventParam);
  const openDialog = (d: Dialog) => () => setDialog(d);
  const close = (v: boolean) => { if (!v) setDialog(null); };

  return (
    <div>
      <a href="#/customers" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-fg"><ArrowLeft size={12} /> 客户</a>
      <PageHeader
        title={c.email}
        description={<span className="inline-flex flex-wrap items-center gap-2"><Dot tone={STATE[c.state].tone} /> {STATE[c.state].label} · {c.wechat ?? '没留微信'} · 开通于 {date(c.joinedAt)} · <span className="num text-faint">{c.id}</span></span>}
        actions={<>
          <Button icon={<CalendarPlus size={14} />} onClick={openDialog('renew')}>续期</Button>
          <Button icon={<RefreshCcw size={14} />} onClick={() => toast('已让客户端刷新目录，下次心跳生效', 'ok')}>刷新目录</Button>
          <Button variant="danger" onClick={openDialog('disable')}>停用</Button>
        </>}
      />

      <section className={`mb-4 flex flex-wrap items-center gap-4 rounded-lg border px-4 py-3 ${failing ? 'border-sev/40 bg-sev-soft' : 'border-line bg-panel'}`}>
        <Dot tone={failing ? 'sev' : STATE[c.state].tone} pulse={failing} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{failing ? `现在连不上：${c.stateReason}` : c.state === 'online' ? `正在用 ${c.node}，一切正常` : c.stateReason ?? `离线，最后在线 ${c.lastSeen ? ago(c.lastSeen) : '—'}`}</div>
          <div className="text-xs text-muted">{failing ? '同一节点上还有 4 位客户连不上。Tokyo · Neon 空闲且三网正常。' : `客户端 ${c.platform} ${c.version} · ${c.devices} 台设备`}</div>
        </div>
        {failing && <Button variant="primary" icon={<Shuffle size={14} />} onClick={openDialog('switch')}>让客户端换到 Tokyo · Neon</Button>}
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
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
          <Panel title="时间线" description="连接、换节点、目录与更新，按时间倒序；点一行看原始记录" source="connection_events" flush>
            <div className="max-h-[520px] overflow-y-auto">
              {days.map((d) => (
                <div key={d}>
                  <h3 className="sticky top-0 z-1 border-b border-line bg-panel-2 px-4 py-1 text-xs font-medium text-muted">{d}</h3>
                  <ul aria-label={d}>
                  {events.map((e, i) => (date(e.at) !== d ? null : (
                    <li key={i}><button type="button" data-row="" onClick={() => setEventParam(String(i))}
                      className="flex w-full items-center gap-3 border-b border-line px-4 py-2 text-left text-sm last:border-b-0 hover:bg-hover focus-visible:bg-accent-soft">
                      <span className="w-11 shrink-0 text-xs num text-faint">{time(e.at)}</span>
                      <span className="w-14 shrink-0"><Badge tone={EVENT[e.kind].tone}>{EVENT[e.kind].label}</Badge></span>
                      <span className="min-w-0 flex-1 truncate">
                        {e.code ? <><span className="num text-xs">{e.code}</span> <span className="text-muted">· {CODE_TEXT[e.code] ?? ''} · {e.stage}</span></> : e.detail}
                      </span>
                      <span className="w-40 shrink-0 truncate text-right text-xs text-muted max-sm:hidden">{e.node ?? ''}</span>
                      <span className="w-14 shrink-0 text-right text-xs num text-faint">{e.elapsed ? ms(e.elapsed) : ''}</span>
                    </button></li>
                  )))}
                  </ul>
                </div>
              ))}
            </div>
          </Panel>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="用量" source="operations_user_usage_hours" ageMin={55} staleAfter={90}>
              <LineChart height={140} longRange={range === '7d' || range === '30d'} format={bytes} series={[{ name: '用量', color: 'var(--c1)', points: customerUsage(c, range), area: true }]} />
            </Panel>
            <Panel title="什么时候在用" description="过去 7 天，每格一小时">
              <div className="overflow-x-auto" tabIndex={0} aria-label="过去 7 天每小时用量热力图，可横向滚动"><Heatmap rows={customerWeek(c)} rowLabels={['周四', '周五', '周六', '周日', '周一', '周二', '周三']} cell={11} /></div>
            </Panel>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="设备" source="ops_device_status" flush>
            {Array.from({ length: c.devices }, (_, i) => (
              <div key={i} className="border-b border-line px-4 py-3 last:border-b-0">
                <div className="flex items-center gap-2 text-sm"><Dot tone={i === 0 ? STATE[c.state].tone : 'idle'} /><span className="font-medium">{i === 0 ? (c.platform === 'macOS' ? 'MacBook Pro' : 'DESKTOP-HOME') : c.platform === 'macOS' ? 'Mac mini' : 'LAPTOP-WORK'}</span><span className="ml-auto text-xs text-muted">{c.platform} {c.version}</span></div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button size="xs" onClick={() => toast('已请求诊断快照，约 1 分钟后出现在时间线', 'info')}>诊断快照</Button>
                  <Button size="xs" onClick={() => toast('已让这台设备刷新目录', 'ok')}>刷新目录</Button>
                </div>
              </div>
            ))}
          </Panel>
          <Panel title="跟进" description="只给运维看；写进审计">
            <ul className="mb-3 flex flex-col gap-2.5">
              {notes.map((n) => (
                <li key={n.at} className="text-sm"><div className="text-xs text-muted">{n.who} · {ago(n.at)}</div><div>{n.text}</div></li>
              ))}
            </ul>
            <form onSubmit={(e) => { e.preventDefault(); if (!draft.trim()) return; setNotes([{ at: NOW, who: 'ray', text: draft.trim() }, ...notes]); setDraft(''); }} className="flex flex-col gap-2">
              <Textarea aria-label="新跟进" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="记一句：客户说了什么、你做了什么" />
              <div className="flex justify-end"><Button size="xs" type="submit" disabled={!draft.trim()}>记下</Button></div>
            </form>
          </Panel>
          <Panel title="家宽与 Claude">
            <dl className="grid grid-cols-[80px_1fr] gap-y-2 text-sm">
              <dt className="text-muted">家宽出口</dt><dd>{c.residential ? <a className="hover:underline" href={`#/residential?focus=${c.residential}`}>{c.residential}</a> : <span className="text-muted">没有绑定</span>}</dd>
              <dt className="text-muted">Claude</dt><dd>{claude ? `已分配 ${claude}` : <span className="text-muted">没有</span>}</dd>
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
            {logUntil ? (
              <div className="flex items-start gap-3 text-sm">
                <LockOpen size={16} className="mt-0.5 text-warn" />
                <div className="flex-1"><div className="font-medium">窗口开到 {time(logUntil)}</div><div className="text-muted">期间上传的主机名日志可读，每次读取写审计。</div></div>
                <Button size="xs" onClick={() => { setLogUntil(null); toast('窗口已提前关闭', 'ok'); }}>提前关闭</Button>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-3 text-sm">
                  <Lock size={16} className="mt-0.5 text-muted" />
                  <div className="flex-1 text-muted">没有打开的窗口。打开后 30 分钟内客户端上传的主机名日志可读，到期自动关闭。</div>
                </div>
                <div className="mt-3"><Button size="xs" icon={<FileSearch size={12} />} onClick={openDialog('logs')}>打开 30 分钟窗口</Button></div>
              </>
            )}
          </Panel>
        </div>
      </div>

      <EventDrawer customer={c} event={events[eventIndex] ?? null} index={eventIndex} onClose={() => setEventParam(null)} />
      <RenewDrawer c={c} open={dialog === 'renew'} onOpenChange={close} />
      <DisableConfirm c={c} open={dialog === 'disable'} onOpenChange={close} />
      <SwitchConfirm c={c} open={dialog === 'switch'} onOpenChange={close} />
      <LogWindowConfirm open={dialog === 'logs'} onOpenChange={close} onOpened={setLogUntil} />
    </div>
  );
}
