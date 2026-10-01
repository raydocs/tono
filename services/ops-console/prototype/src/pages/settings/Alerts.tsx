import { useState } from 'react';
import { Badge, Button, Panel } from '@proto/ds';
import { Field, Input, Select, Switch } from '@proto/ds/forms';
import { Drawer, useToast } from '@proto/ds/overlay';
import { rowProps } from '@proto/keys';

type Rule = { id: string; what: string; level: '严重' | '注意'; delay: string; cooldown: string; to: string; on: boolean; waits?: boolean };

const RULES: Rule[] = [
  { id: 'r1', what: '节点被墙或失联', level: '严重', delay: '15', cooldown: '60', to: 'Telegram · 值班群', on: true },
  { id: 'r2', what: '连接成功率低于 97%', level: '注意', delay: '30', cooldown: '120', to: 'Telegram · 值班群', on: true },
  { id: 'r3', what: '失败聚类新开或 5 倍尖峰', level: '注意', delay: '0', cooldown: '60', to: 'Webhook · 工程机器人', on: false, waits: true },
  { id: 'r4', what: '家宽失联', level: '注意', delay: '30', cooldown: '240', to: 'Telegram · ray', on: true },
];

const DELAYS = [{ value: '0', label: '立即' }, { value: '5', label: '持续 5 分钟' }, { value: '15', label: '持续 15 分钟' }, { value: '30', label: '持续 30 分钟' }];

function RuleDrawer({ rule, onClose, onSave }: { rule: Rule | 'new' | null; onClose: () => void; onSave: (r: Rule) => void }) {
  const base: Rule = rule && rule !== 'new' ? rule : { id: 'new', what: '', level: '注意', delay: '15', cooldown: '60', to: 'Telegram · 值班群', on: true };
  const [draft, setDraft] = useState<Rule>(base);
  const [touched, setTouched] = useState(false);
  const k = rule === null ? '' : base.id;
  const [key, setKey] = useState(k);
  if (key !== k) { setKey(k); setDraft(base); setTouched(false); }
  const set = <K extends keyof Rule>(k: K, v: Rule[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const whatError = !draft.what.trim() ? '必填' : null;
  const coolError = !/^\d+$/.test(draft.cooldown) || Number(draft.cooldown) < 5 ? '至少 5 分钟' : null;
  const valid = !whatError && !coolError;
  return (
    <Drawer open={rule !== null} onOpenChange={(v) => { if (!v) onClose(); }} title={rule === 'new' ? '新建告警规则' : '编辑告警规则'} subtitle="延迟防止抖动误报，冷却防止刷屏。"
      footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={touched && !valid} onClick={() => { setTouched(true); if (valid) { onSave(draft.id === 'new' ? { ...draft, id: `r${draft.what}` } : draft); onClose(); } }}>保存</Button></>}>
      <form className="flex flex-col gap-4" noValidate onSubmit={(e) => e.preventDefault()}>
        <Field label="条件" required error={touched ? whatError : null} hint="用判定引擎已有的信号；新信号要先在 Worker 里定义。">
          <Input value={draft.what} onChange={(e) => set('what', e.target.value)} placeholder="例如：连接成功率低于 97%" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="级别" required><Select value={draft.level} onChange={(e) => set('level', e.target.value as Rule['level'])} options={[{ value: '严重', label: '严重' }, { value: '注意', label: '注意' }]} /></Field>
          <Field label="触发" required><Select value={draft.delay} onChange={(e) => set('delay', e.target.value)} options={DELAYS} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="冷却（分钟）" required error={touched ? coolError : null}><Input inputMode="numeric" value={draft.cooldown} onChange={(e) => set('cooldown', e.target.value)} /></Field>
          <Field label="发给" required><Select value={draft.to} onChange={(e) => set('to', e.target.value)} options={['Telegram · 值班群', 'Telegram · ray', 'Webhook · 工程机器人'].map((v) => ({ value: v, label: v }))} /></Field>
        </div>
        <div className="flex items-center justify-between rounded-md border border-line px-3 py-2.5">
          <div><div className="text-sm font-medium">启用</div><div className="text-xs text-muted">关掉后规则保留，不再通知</div></div>
          <Switch checked={draft.on} onChange={(v) => set('on', v)} label="启用" />
        </div>
      </form>
    </Drawer>
  );
}

export function Alerts() {
  const toast = useToast();
  const [rules, setRules] = useState(RULES);
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const delay = (d: string) => DELAYS.find((x) => x.value === d)?.label ?? d;
  return (
    <Panel title="规则" description="延迟与冷却防止刷屏；测试发送不影响计数" source="ops_alert_rules" flush actions={<Button size="xs" variant="primary" onClick={() => setEditing('new')}>新建规则</Button>}>
      <table className="tbl">
        <thead><tr><th>条件</th><th>级别</th><th className="max-md:hidden">触发</th><th className="max-lg:hidden">发给</th><th>状态</th><th><span className="sr-only">操作</span></th></tr></thead>
        <tbody>{rules.map((r) => (
          <tr key={r.id} {...rowProps(() => setEditing(r), `编辑 ${r.what}`)}>
            <td>{r.what}</td>
            <td><Badge tone={r.level === '严重' ? 'sev' : 'warn'}>{r.level}</Badge></td>
            <td className="text-muted max-md:hidden">{delay(r.delay)} · 冷却 {r.cooldown} 分钟</td>
            <td className="text-muted max-lg:hidden">{r.to}</td>
            <td>{r.waits ? <Badge dot>等 #707</Badge> : r.on ? <Badge tone="ok" dot>启用</Badge> : <Badge dot>停用</Badge>}</td>
            <td className="r" onClick={(e) => e.stopPropagation()}><Button size="xs" variant="ghost" onClick={() => toast(`已发送测试：${r.to}`, 'ok')}>测试发送</Button></td>
          </tr>
        ))}</tbody>
      </table>
      <RuleDrawer rule={editing} onClose={() => setEditing(null)}
        onSave={(r) => { setRules((xs) => (xs.some((x) => x.id === r.id) ? xs.map((x) => (x.id === r.id ? r : x)) : [...xs, r])); toast('规则已保存', 'ok'); }} />
    </Panel>
  );
}
