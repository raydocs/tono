import { useState } from 'react';
import { Check } from 'lucide-react';
import { Badge, Button } from '@proto/ds';
import { Field, Input, Select, Textarea } from '@proto/ds/forms';
import { Code, Confirm, Drawer, KV, Section, useToast } from '@proto/ds/overlay';
import { cny, dateTime, usd } from '@proto/format';
import type { LedgerRow } from '@proto/mock/business';

export function CloseMonthConfirm({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const checks = ['所有账单源已同步到 8/31 24:00', '没有待冲正的行', '汇率快照已取（USD→CNY 7.10）', '每位客户毛利已算出'];
  return (
    <Confirm open={open} onOpenChange={onOpenChange} tone="danger" title="关闭 2026 年 8 月" action="关账" typed="2026-08"
      description="关账后 8 月的收入、成本和每位客户的毛利冻结。之后的更正只能在 9 月记冲正。"
      impact={<ul className="flex flex-col gap-1.5">{checks.map((c) => <li key={c} className="flex items-center gap-2"><Check size={14} className="text-ok" aria-hidden />{c}</li>)}</ul>}
      steps={['冻结 8 月账本', '写入汇率快照', '生成月报', '写审计']} doneText="8 月已关账" />
  );
}

export function EntryDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const toast = useToast();
  const [kind, setKind] = useState('收入');
  const [currency, setCurrency] = useState('CNY');
  const [amount, setAmount] = useState('');
  const [subject, setSubject] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const amountError = !/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 ? '大于 0，最多两位小数' : null;
  const subjectError = !subject.trim() ? '必填' : null;
  const valid = !amountError && !subjectError;
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="记一笔" subtitle="写进 ops_ledger_entries。记错了只能冲正，不能改。"
      footer={<><Button onClick={() => onOpenChange(false)}>取消</Button><Button variant="primary" disabled={touched && !valid} onClick={() => { setTouched(true); if (valid) { onOpenChange(false); toast(`已记账：${kind} ${currency === 'USD' ? '$' : '¥'}${amount}`, 'ok'); } }}>记账</Button></>}>
      <form className="flex flex-col gap-4" noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="类型" required><Select value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: '收入', label: '收入' }, { value: '支出', label: '支出' }]} /></Field>
          <Field label="币种" required><Select value={currency} onChange={(e) => setCurrency(e.target.value)} options={[{ value: 'CNY', label: '人民币' }, { value: 'USD', label: '美元（按当天汇率折算）' }]} /></Field>
        </div>
        <Field label="金额" required error={touched ? amountError : null}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="150" className="num" /></Field>
        <Field label={kind === '收入' ? '客户' : '商家与项目'} required error={touched ? subjectError : null}>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={kind === '收入' ? 'chen.jie@gmail.com' : 'DMIT · Los Angeles · Mesa'} />
        </Field>
        <Field label="说明" hint="例如：续费 3 个月、流量加购。"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
      </form>
    </Drawer>
  );
}

export function LedgerDrawer({ row, onClose }: { row: LedgerRow | undefined; onClose: () => void }) {
  const [reverse, setReverse] = useState(false);
  const money = (m: number) => (row?.currency === 'USD' ? usd(m) : cny(m));
  return (
    <>
      <Drawer open={!!row && !reverse} onOpenChange={(v) => { if (!v) onClose(); }} title={row ? `${row.id} · ${row.kind}` : ''} subtitle={row ? dateTime(row.at) : undefined}
        meta={row && <><Badge tone={row.kind === '收入' ? 'ok' : row.kind === '冲正' ? 'warn' : 'idle'}>{row.kind}</Badge><Badge>{row.source}</Badge></>}
        footer={row && <><Button onClick={onClose}>关闭</Button>{row.kind !== '冲正' && row.source === '手工' && <Button variant="danger" onClick={() => setReverse(true)}>冲正这一笔</Button>}</>}>
        {row && <>
          <Section title="内容">
            <KV rows={[['金额', <span key="a" className="text-base font-semibold num">{money(row.amountMinor)}</span>], ['对象', row.subject], ['说明', row.note], ['来源', row.source === '账单源' ? '账单源自动同步，不能手工冲正' : '手工记账']]} />
          </Section>
          <Section title="原始记录"><Code label="ops_ledger_entries" value={{ id: row.id, at: new Date(row.at).toISOString(), kind: row.kind, subject: row.subject, note: row.note, amount_minor: row.amountMinor, currency: row.currency, source: row.source }} /></Section>
        </>}
      </Drawer>
      <Confirm open={reverse} onOpenChange={(v) => { setReverse(v); if (!v) onClose(); }} tone="danger" title={row ? `冲正 ${row.id}` : ''} action="记冲正"
        description="新增一行等额负数，原行不动。两行在账本里互相引用。"
        impact={row && <KV rows={[['原行', `${row.id} · ${money(row.amountMinor)}`], ['冲正行', `${money(-row.amountMinor)} · 记在本月`]]} />}
        doneText={row ? `已冲正 ${row.id}` : ''} />
    </>
  );
}
