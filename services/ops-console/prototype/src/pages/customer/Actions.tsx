import { useState } from 'react';
import { Button } from '@proto/ds';
import { Field, Select, Switch, Textarea } from '@proto/ds/forms';
import { Confirm, Drawer, KV, useToast } from '@proto/ds/overlay';
import { cny, date, DAY, NOW, time } from '@proto/format';
import type { Customer } from '@proto/mock/customers';

export function RenewDrawer({ c, open, onOpenChange }: { c: Customer; open: boolean; onOpenChange: (v: boolean) => void }) {
  const toast = useToast();
  const [months, setMonths] = useState('1');
  const [ledger, setLedger] = useState(true);
  const [note, setNote] = useState('');
  const m = Number(months);
  const from = Math.max(c.expiresAt, NOW);
  const to = from + m * 30 * DAY;
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="续期" subtitle={c.email}
      footer={<><Button onClick={() => onOpenChange(false)}>取消</Button><Button variant="primary" onClick={() => { onOpenChange(false); toast(`已续期到 ${date(to)}${ledger ? '，已记账' : ''}`, 'ok'); }}>续期 {m} 个月</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
        <Field label="时长" required>
          <Select value={months} onChange={(e) => setMonths(e.target.value)} options={[{ value: '1', label: '1 个月' }, { value: '3', label: '3 个月' }, { value: '6', label: '6 个月' }, { value: '12', label: '12 个月' }]} />
        </Field>
        <KV rows={[['现在到期', date(c.expiresAt)], ['续期后', <span key="t" className="font-medium">{date(to)}</span>], ['应收', cny(c.planMinor * m)]]} />
        <div className="flex items-center justify-between rounded-md border border-line px-3 py-2.5">
          <div><div className="text-sm font-medium">同时记一笔收入</div><div className="text-xs text-muted">写进账本；关账后只能冲正</div></div>
          <Switch checked={ledger} onChange={setLedger} label="同时记一笔收入" />
        </div>
        <Field label="备注" hint="客户看不到，写进审计。">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：微信转账 9/30 已收" rows={3} />
        </Field>
      </form>
    </Drawer>
  );
}

export function DisableConfirm({ c, open, onOpenChange }: { c: Customer; open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Confirm open={open} onOpenChange={onOpenChange} tone="danger" title="停用这位客户" action="停用" typed={c.email}
      description="停用后这位客户的所有设备在下次心跳时断开，节点上的身份一并撤销。可以随时恢复。"
      impact={<ul className="flex flex-col gap-1"><li>{c.devices} 台设备会断开</li><li>{c.residential ? `家宽 ${c.residential} 变为闲置` : '没有绑定家宽'}</li><li>到期日不变，不自动退款</li></ul>}
      steps={['撤销节点身份', '通知客户端下线', '写审计']} doneText="已停用" />
  );
}

export function SwitchConfirm({ c, open, onOpenChange }: { c: Customer; open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Confirm open={open} onOpenChange={onOpenChange} title="让客户端换到 Tokyo · Neon" action="发送"
      description={`只改这位客户的首选节点，不动目录。客户端下次心跳（≤ 60 秒）会重连。现在在 ${c.node ?? '—'}。`}
      impact={<KV rows={[['目标', 'Tokyo · Neon · 空闲 4/10 · 三网正常'], ['影响', `${c.devices} 台设备重连一次，约 2 秒断流`]]} />}
      steps={['写入首选节点', '等待客户端心跳', '确认已连上 Tokyo · Neon']} doneText="已换到 Tokyo · Neon" />
  );
}

export function LogWindowConfirm({ open, onOpenChange, onOpened }: { open: boolean; onOpenChange: (v: boolean) => void; onOpened: (until: number) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Confirm open={open} onOpenChange={onOpenChange} tone="danger" title="打开 30 分钟原始日志窗口" action="打开窗口"
      description="窗口内客户端上传的主机名日志可读。打开和每次读取都写审计，到期自动关闭；需要 owner 角色（customers.raw-logs）。"
      impact={<label className="block"><span className="text-xs text-muted">为什么要看（写进审计，必填）</span><input className="field-input mt-1.5" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：客户反馈 YouTube 走错出口" /></label>}
      blocked={!reason.trim()}
      onDone={() => onOpened(NOW + 30 * 60_000)} doneText={`窗口已打开，到 ${time(NOW + 30 * 60_000)} 关闭`} />
  );
}
