import { useState } from 'react';
import { Button } from '@proto/ds';
import { Checkbox, EMAIL, Field, Input, Select, Switch } from '@proto/ds/forms';
import { Drawer, useToast } from '@proto/ds/overlay';
import { CUSTOMERS } from '@proto/mock/customers';

export function CreateDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [wechat, setWechat] = useState('');
  const [months, setMonths] = useState('1');
  const [quota, setQuota] = useState('200');
  const [claude, setClaude] = useState(false);
  const [touched, setTouched] = useState(false);
  const taken = CUSTOMERS.some((c) => c.email === email.trim().toLowerCase());
  const emailError = !email.trim() ? '必填' : !EMAIL.test(email.trim()) ? '邮箱格式不对' : taken ? '这个邮箱已经开通过' : null;
  const quotaError = !/^\d+$/.test(quota) || Number(quota) < 10 ? '至少 10 GB，整数' : null;
  const valid = !emailError && !quotaError;
  function submit() {
    setTouched(true);
    if (!valid) return;
    onOpenChange(false);
    toast(`已开通 ${email.trim()}，激活链接已复制`, 'ok');
    setEmail(''); setWechat(''); setTouched(false);
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="开通客户" subtitle="开通后生成一次性激活链接，客户在客户端里粘贴即可。"
      footer={<><Button onClick={() => onOpenChange(false)}>取消</Button><Button variant="primary" onClick={submit} disabled={touched && !valid}>开通并复制链接</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Field label="邮箱" required error={touched ? emailError : null} hint="登录名，也是账单上的名字。">
          <Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched(true)} placeholder="name@example.com" />
        </Field>
        <Field label="微信号" hint="选填，只给运维看。">
          <Input value={wechat} onChange={(e) => setWechat(e.target.value)} placeholder="wxid_…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="首期" required>
            <Select value={months} onChange={(e) => setMonths(e.target.value)} options={[{ value: '1', label: '1 个月' }, { value: '3', label: '3 个月' }, { value: '12', label: '12 个月' }]} />
          </Field>
          <Field label="月流量（GB）" required error={touched ? quotaError : null}>
            <Input inputMode="numeric" value={quota} onChange={(e) => setQuota(e.target.value)} />
          </Field>
        </div>
        <div className="flex items-center justify-between rounded-md border border-line px-3 py-2.5">
          <div><div className="text-sm font-medium">分配 Claude 账号</div><div className="text-xs text-muted">从闲置池里取一个；池里现在 4 个</div></div>
          <Switch checked={claude} onChange={setClaude} label="分配 Claude 账号" />
        </div>
      </form>
    </Drawer>
  );
}

const FIELDS = [
  ['email', '邮箱'], ['wechat', '微信号'], ['state', '状态'], ['platform', '客户端'], ['node', '节点'],
  ['lastSeen', '最后在线'], ['success24h', '成功率 24h'], ['usage', '用量'], ['expiresAt', '到期'], ['plan', '月费'],
] as const;

export function ExportDrawer({ open, onOpenChange, count }: { open: boolean; onOpenChange: (v: boolean) => void; count: number }) {
  const toast = useToast();
  const [on, setOn] = useState<Set<string>>(() => new Set(['email', 'state', 'expiresAt', 'usage']));
  const all = on.size === FIELDS.length;
  const flip = (k: string) => setOn((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="导出 CSV" subtitle={`按当前筛选导出 ${count} 位客户。导出写进审计。`}
      footer={<><Button onClick={() => onOpenChange(false)}>取消</Button><Button variant="primary" disabled={on.size === 0} onClick={() => { onOpenChange(false); toast(`已导出 ${count} 行 × ${on.size} 列`, 'ok'); }}>导出 {on.size} 列</Button></>}>
      <fieldset>
        <legend className="mb-2 flex w-full items-center gap-2 text-sm font-medium">
          <Checkbox checked={all} indeterminate={!all && on.size > 0} label="全选" onChange={(v) => setOn(new Set(v ? FIELDS.map(([k]) => k) : []))} />
          字段
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {FIELDS.map(([k, label]) => (
            <label key={k} className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm hover:bg-hover">
              <Checkbox checked={on.has(k)} onChange={() => flip(k)} label={label} />{label}
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">不含设备 ID 和原始日志；需要这些走「原始日志窗口」。</p>
      </fieldset>
    </Drawer>
  );
}
