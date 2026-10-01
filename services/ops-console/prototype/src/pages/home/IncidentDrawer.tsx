import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Badge, Button, Dot } from '@proto/ds';
import { Field, Select, Textarea } from '@proto/ds/forms';
import { Drawer, KV, Section, useToast } from '@proto/ds/overlay';
import { dateTime, NOW, time } from '@proto/format';
import { customerById } from '@proto/mock/customers';
import { incidentLog } from '@proto/mock/details';
import type { Incident } from '@proto/mock/observe';

type Mode = null | 'mute' | 'close';

export function IncidentDrawer({ inc, onClose }: { inc: Incident | undefined; onClose: () => void }) {
  const toast = useToast();
  const [claimed, setClaimed] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [mute, setMute] = useState('60');
  const [note, setNote] = useState('');
  const owner = inc?.owner ?? (claimed === inc?.id ? 'ray' : null);
  const target = inc?.subject.kind === 'node' ? `#/nodes/${encodeURIComponent(inc.subject.id)}` : '#/clients';
  const needNote = mode === 'close' && !note.trim();
  function submit() {
    if (!inc || needNote) return;
    toast(mode === 'mute' ? `已静音 ${mute} 分钟，到 ${time(NOW + Number(mute) * 60_000)} 恢复` : `已关闭 ${inc.id}`, 'ok');
    setMode(null); setNote('');
    if (mode === 'close') onClose();
  }
  return (
    <Drawer open={!!inc} onOpenChange={(v) => { if (!v) { setMode(null); onClose(); } }} wide
      title={inc?.title ?? ''} subtitle={inc ? `${inc.id} · 开启于 ${dateTime(inc.since)}` : undefined}
      meta={inc && <><Badge tone={inc.severity}>{inc.severity === 'sev' ? '严重' : '注意'}</Badge><Badge tone={owner ? 'info' : 'idle'}>{owner ? `${owner} 在处理` : '无人认领'}</Badge></>}
      footer={inc && (mode ? <>
        <Button onClick={() => setMode(null)}>返回</Button>
        <Button variant={mode === 'close' ? 'danger-solid' : 'primary'} disabled={needNote} onClick={submit}>{mode === 'mute' ? `静音 ${mute} 分钟` : '关闭事故'}</Button>
      </> : <>
        <Button variant="ghost" onClick={() => setMode('mute')}>静音</Button>
        <Button variant="ghost" onClick={() => setMode('close')}>关闭</Button>
        {!owner && <Button onClick={() => { setClaimed(inc.id); toast(`已认领 ${inc.id}`, 'ok'); }}>认领</Button>}
        <Button variant="primary" href={target} icon={<ArrowRight size={14} />}>去处理</Button>
      </>)}>
      {inc && (mode ? (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {mode === 'mute' && (
            <Field label="静音多久" hint="只停 Telegram 通知；事故仍在首页，判定引擎仍在跑。">
              <Select value={mute} onChange={(e) => setMute(e.target.value)} options={[{ value: '30', label: '30 分钟' }, { value: '60', label: '1 小时' }, { value: '240', label: '4 小时' }]} />
            </Field>
          )}
          <Field label={mode === 'close' ? '怎么解决的' : '备注'} required={mode === 'close'} error={mode === 'close' && note === '' ? null : needNote ? '关闭事故要写原因' : null}
            hint={mode === 'close' ? '写进事故记录和审计。信号没恢复的话，判定引擎会重新开一个。' : '选填'}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={mode === 'close' ? '例如：Mesa 已下架，5 位客户切到 Tokyo · Neon' : ''} />
          </Field>
        </form>
      ) : <>
        <Section title="现在">
          <KV rows={[
            ['信号', inc.signal],
            ['持续', `${Math.round((NOW - inc.since) / 60_000)} 分钟`],
            ['影响', `${inc.affected} 位客户`],
            ['建议下一步', <span key="n" className="font-medium">{inc.next}</span>],
          ]} />
        </Section>
        <Section title={`受影响的客户 · ${inc.affectedIds.length}`}>
          {inc.affectedIds.length === 0 ? <p className="text-sm text-muted">现在没有客户卡在这里。</p> : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {inc.affectedIds.map((id) => customerById(id)).filter(Boolean).map((c) => (
                <li key={c!.id}><a href={`#/customers/${c!.id}`} className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-hover">
                  <Dot tone="sev" /><span className="flex-1 truncate">{c!.email}</span><span className="text-xs text-muted">{c!.platform} {c!.version}</span><ArrowRight size={13} className="text-faint" />
                </a></li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="经过">
          <ol className="relative ml-1.5 border-l border-line">
            {incidentLog(inc).map((r) => (
              <li key={`${r.at}${r.what}`} className="relative pb-3 pl-4 last:pb-0">
                <span className="absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full bg-line-strong" />
                <div className="text-xs text-muted"><span className="num">{time(r.at)}</span> · {r.who}</div>
                <div className="text-sm">{r.what}</div>
              </li>
            ))}
          </ol>
        </Section>
      </>)}
    </Drawer>
  );
}
