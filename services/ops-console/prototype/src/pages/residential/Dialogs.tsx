import { useState } from 'react';
import { Check, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProbeStrip } from '@proto/charts/small';
import { Button, Dot } from '@proto/ds';
import { Field, Input, Select, Switch, Textarea } from '@proto/ds/forms';
import { Drawer, KV, Section, useToast } from '@proto/ds/overlay';
import { cny, date, pct } from '@proto/format';
import type { HomeExit } from '@proto/mock/business';
import { CUSTOMERS, customerById } from '@proto/mock/customers';

export function BindDrawer({ h, onClose }: { h: HomeExit | undefined; onClose: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [claude, setClaude] = useState(true);
  const current = h?.boundTo ? customerById(h.boundTo) : null;
  const matches = CUSTOMERS.filter((c) => c.state !== 'disabled' && c.id !== h?.boundTo)
    .filter((c) => !q || `${c.email} ${c.wechat ?? ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  const target = pick ? customerById(pick) : null;
  const alive = h ? h.probes.filter((p) => p === 'alive').length / h.probes.filter((p) => p != null).length : 0;
  return (
    <Drawer open={!!h} onOpenChange={(v) => { if (!v) { setPick(null); setQ(''); onClose(); } }} title={h ? `${current ? '换绑' : '绑定'} ${h.id}` : ''}
      subtitle={h ? `${h.label} · ${h.vendor} · ${cny(h.costMinor)}/月` : undefined}
      footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!target} onClick={() => { toast(`${h?.id} 已${current ? '换绑' : '绑定'}到 ${target?.email}`, 'ok'); onClose(); }}>{current ? '换绑' : '绑定'}</Button></>}>
      {h && <>
        <Section title="这条家宽">
          <KV rows={[
            ['探测 24h', <span key="p" className="inline-flex items-center gap-2"><ProbeStrip probes={h.probes} height={14} /><span className="text-xs num">{pct(alive, 0)}</span></span>],
            ['现在给了', current ? current.email : '闲置'],
            ['续费', date(h.renewAt)],
          ]} />
        </Section>
        <Section title="给谁">
          <label className="flex h-8 items-center gap-2 rounded-md border border-line-strong px-2.5 text-sm focus-within:border-accent">
            <Search size={14} className="text-muted" aria-hidden />
            <input autoFocus aria-label="搜索客户" value={q} onChange={(e) => setQ(e.target.value)} placeholder="邮箱或微信号" className="flex-1 bg-transparent outline-none focus-visible:outline-none" />
          </label>
          <ul role="listbox" aria-label="客户" className="mt-2 divide-y divide-line rounded-md border border-line">
            {matches.map((c) => (
              <li key={c.id} role="option" aria-selected={pick === c.id} tabIndex={0}
                onClick={() => setPick(c.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPick(c.id); } }}
                className={cn('flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-hover', pick === c.id && 'bg-accent-soft')}>
                <span className="flex-1 truncate">{c.email}</span>
                {c.residential && <span className="text-xs text-warn">已有 {c.residential}</span>}
                {pick === c.id && <Check size={14} className="text-accent" aria-hidden />}
              </li>
            ))}
            {matches.length === 0 && <li className="px-3 py-3 text-sm text-muted">没有匹配的客户</li>}
          </ul>
        </Section>
        <div className="flex items-center justify-between rounded-md border border-line px-3 py-2.5">
          <div><div className="text-sm font-medium">Claude 账号跟着家宽走</div><div className="text-xs text-muted">{h.claudeAccount ?? '这条家宽没有绑 Claude 账号'}</div></div>
          <Switch checked={claude} onChange={setClaude} label="Claude 账号跟着家宽走" />
        </div>
        {current && target && <p className="mt-3 text-xs text-muted">{current.email} 下次同步时失去这条出口，客户端回落到普通节点。</p>}
      </>}
    </Drawer>
  );
}

type Parsed = { line: number; id: string; vendor: string; price: string; error: string | null };

function parse(text: string, existing: Set<string>): Parsed[] {
  return text.split('\n').map((l, i) => ({ l: l.trim(), i })).filter(({ l }) => l).map(({ l, i }) => {
    const [id = '', vendor = '', price = ''] = l.split(',').map((s) => s.trim());
    const error = !/^[A-Z]{2}-Home-\d{2}$/.test(id) ? '编号应为 JP-Home-17 这种格式'
      : existing.has(id) ? '编号已存在' : !vendor ? '缺商家' : !/^\d+$/.test(price) ? '月租要是整数（元）' : null;
    return { line: i + 1, id, vendor, price, error };
  });
}

export function ImportDrawer({ open, onOpenChange, existing }: { open: boolean; onOpenChange: (v: boolean) => void; existing: string[] }) {
  const toast = useToast();
  const [text, setText] = useState('JP-Home-17, IPRoyal, 60\nJP-Home-18, Soax, 75\nJP-Home-03, IPRoyal, 60\nJP-Home-19, , 45');
  const rows = parse(text, new Set(existing));
  const bad = rows.filter((r) => r.error).length;
  return (
    <Drawer open={open} onOpenChange={onOpenChange} wide title="批量导入家宽" subtitle="每行一条：编号, 商家, 月租（元）。先校验，全部通过才能导入。"
      footer={<><Button onClick={() => onOpenChange(false)}>取消</Button><Button variant="primary" disabled={rows.length === 0 || bad > 0} onClick={() => { onOpenChange(false); toast(`已导入 ${rows.length} 条家宽`, 'ok'); }}>导入 {rows.length} 条</Button></>}>
      <Field label="CSV" hint="不含表头；可以从商家后台直接粘贴。">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className="num text-xs" />
      </Field>
      <div className="mt-4 overflow-hidden rounded-md border border-line">
        <div className={cn('flex items-center gap-2 border-b border-line px-3 py-2 text-sm', bad ? 'bg-sev-soft text-sev' : 'bg-ok-soft text-ok')} role="status">
          <Dot tone={bad ? 'sev' : 'ok'} />{bad ? `${bad} 行有问题，改好后再导入` : `${rows.length} 行都通过`}
        </div>
        <table className="tbl">
          <thead><tr><th className="r">行</th><th>编号</th><th>商家</th><th className="r">月租</th><th>校验</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.line}>
              <td className="r num text-muted">{r.line}</td><td className="num">{r.id || '—'}</td><td>{r.vendor || '—'}</td><td className="r num">{r.price ? `¥${r.price}` : '—'}</td>
              <td className={r.error ? 'text-sev' : 'text-ok'}>{r.error ?? '通过'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Drawer>
  );
}

export function AddDrawer({ open, onOpenChange, existing }: { open: boolean; onOpenChange: (v: boolean) => void; existing: string[] }) {
  const toast = useToast();
  const [id, setId] = useState('JP-Home-17');
  const [vendor, setVendor] = useState('IPRoyal');
  const [price, setPrice] = useState('60');
  const [endpoint, setEndpoint] = useState('');
  const [touched, setTouched] = useState(false);
  const idError = !/^[A-Z]{2}-Home-\d{2}$/.test(id) ? '编号应为 JP-Home-17 这种格式' : existing.includes(id) ? '编号已存在' : null;
  const endpointError = !/^[\w.-]+:\d{2,5}$/.test(endpoint) ? '写成 host:port' : null;
  const priceError = !/^\d+$/.test(price) ? '整数（元）' : null;
  const valid = !idError && !endpointError && !priceError;
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="登记家宽" subtitle="登记后先跑 3 次探测，通过才进可分配池。"
      footer={<><Button onClick={() => onOpenChange(false)}>取消</Button><Button variant="primary" disabled={touched && !valid} onClick={() => { setTouched(true); if (valid) { onOpenChange(false); toast(`${id} 已登记，探测中`, 'ok'); } }}>登记并探测</Button></>}>
      <form className="flex flex-col gap-4" noValidate onSubmit={(e) => e.preventDefault()}>
        <Field label="编号" required error={touched ? idError : null}><Input value={id} onChange={(e) => setId(e.target.value)} className="num" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="商家" required><Select value={vendor} onChange={(e) => setVendor(e.target.value)} options={['IPRoyal', 'ProxyEmpire', 'Soax'].map((v) => ({ value: v, label: v }))} /></Field>
          <Field label="月租（元）" required error={touched ? priceError : null}><Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        </div>
        <Field label="出口地址" required error={touched ? endpointError : null} hint="SOCKS5；凭据走 Worker secret，不在这里填。">
          <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="gw.iproyal.com:12321" className="num" />
        </Field>
      </form>
    </Drawer>
  );
}
