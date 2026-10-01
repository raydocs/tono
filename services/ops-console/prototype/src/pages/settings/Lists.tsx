import { useState } from 'react';
import { Badge, Button, Panel } from '@proto/ds';
import { EMAIL, Field, Input, Select } from '@proto/ds/forms';
import { Confirm, Drawer, useToast } from '@proto/ds/overlay';

type Verdict = 'pending' | 'accepted' | 'rejected';
const CANDIDATES = [
  { domain: 'bilibili.com', usage: '14 位客户 · 2.1 GB', why: '国内 CDN' },
  { domain: 'qq.com', usage: '11 位客户 · 640 MB', why: '国内' },
  { domain: 'zhihu.com', usage: '6 位客户 · 120 MB', why: '国内' },
  { domain: 'doubleclick.net', usage: '9 位客户 · 80 MB', why: '境外广告，不应直连' },
];

export function Candidates() {
  const toast = useToast();
  const [verdict, setVerdict] = useState<Record<string, Verdict>>({});
  const accepted = CANDIDATES.filter((c) => verdict[c.domain] === 'accepted');
  return (
    <Panel flush title="待决定" description="只列出解析到大陆 IP 的域名；接受后进规则草稿，不直接发布"
      actions={<Button size="xs" variant="primary" disabled={accepted.length === 0} onClick={() => toast(`已生成规则草稿 r5（+${accepted.length} 个域名），去「分流规则」预演`, 'ok')}>生成规则草稿{accepted.length ? `（${accepted.length}）` : ''}</Button>}>
      <table className="tbl"><tbody>{CANDIDATES.map((c) => {
        const v = verdict[c.domain] ?? 'pending';
        return (
          <tr key={c.domain}>
            <td className="font-medium">{c.domain}</td><td className="text-muted max-md:hidden">{c.usage}</td><td className="text-muted">{c.why}</td>
            <td className="r space-x-1">{v === 'pending' ? <>
              <Button size="xs" onClick={() => setVerdict({ ...verdict, [c.domain]: 'accepted' })}>接受</Button>
              <Button size="xs" variant="ghost" onClick={() => setVerdict({ ...verdict, [c.domain]: 'rejected' })}>拒绝</Button>
            </> : <>
              <Badge tone={v === 'accepted' ? 'ok' : 'idle'}>{v === 'accepted' ? '已接受' : '已拒绝'}</Badge>
              <Button size="xs" variant="ghost" onClick={() => { const next = { ...verdict }; delete next[c.domain]; setVerdict(next); }}>撤销</Button>
            </>}</td>
          </tr>
        );
      })}</tbody></table>
    </Panel>
  );
}

type Provider = { name: string; kind: string; billing: string; login: string };
const PROVIDERS: Provider[] = [
  { name: 'DMIT', kind: '4 台节点', billing: '美元 · 月付', login: 'ops@tono.dev' },
  { name: 'Vultr', kind: '5 台节点', billing: '美元 · 月付', login: 'ops@tono.dev' },
  { name: 'IPRoyal', kind: '8 条家宽', billing: '美元 · 月付', login: 'ray@tono.dev' },
];

export function Providers() {
  const toast = useToast();
  const [rows, setRows] = useState(PROVIDERS);
  const [editing, setEditing] = useState<Provider | 'new' | null>(null);
  const [draft, setDraft] = useState<Provider>({ name: '', kind: '节点', billing: '美元 · 月付', login: '' });
  const [touched, setTouched] = useState(false);
  const open = (p: Provider | 'new') => { setEditing(p); setDraft(p === 'new' ? { name: '', kind: '节点', billing: '美元 · 月付', login: '' } : p); setTouched(false); };
  const nameError = !draft.name.trim() ? '必填' : null;
  const loginError = !EMAIL.test(draft.login) ? '登录邮箱格式不对' : null;
  const valid = !nameError && !loginError;
  return (
    <Panel flush title="账号" description="只存登录名与计费方式；密码和 API key 放 Worker secret" actions={<Button size="xs" variant="primary" onClick={() => open('new')}>添加</Button>}>
      <table className="tbl"><tbody>{rows.map((p) => (
        <tr key={p.name}><td className="font-medium">{p.name}</td><td className="text-muted">{p.kind}</td><td className="text-muted max-md:hidden">{p.billing}</td><td className="text-muted max-lg:hidden">{p.login}</td>
          <td className="r"><Button size="xs" variant="ghost" onClick={() => open(p)}>编辑</Button></td></tr>
      ))}</tbody></table>
      <Drawer open={editing !== null} onOpenChange={(v) => { if (!v) setEditing(null); }} title={editing === 'new' ? '添加商家账号' : `编辑 ${draft.name}`}
        footer={<><Button onClick={() => setEditing(null)}>取消</Button><Button variant="primary" disabled={touched && !valid} onClick={() => {
          setTouched(true);
          if (!valid) return;
          setRows((xs) => (editing === 'new' ? [...xs, draft] : xs.map((x) => (x === editing ? draft : x))));
          setEditing(null); toast('已保存', 'ok');
        }}>保存</Button></>}>
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => e.preventDefault()}>
          <Field label="商家" required error={touched ? nameError : null}><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="登录邮箱" required error={touched ? loginError : null}><Input type="email" value={draft.login} onChange={(e) => setDraft({ ...draft, login: e.target.value })} /></Field>
          <Field label="计费" required><Select value={draft.billing} onChange={(e) => setDraft({ ...draft, billing: e.target.value })} options={['美元 · 月付', '美元 · 年付', '人民币 · 月付'].map((v) => ({ value: v, label: v }))} /></Field>
        </form>
      </Drawer>
    </Panel>
  );
}

export function Allowlist() {
  const toast = useToast();
  const [rows, setRows] = useState([
    { email: 'new.user@gmail.com', note: '微信 wx_new_user', added: '3 天前加入' },
    { email: 'studio.east@qq.com', note: '—', added: '昨天加入' },
  ]);
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [remove, setRemove] = useState<string | null>(null);
  const error = !EMAIL.test(email.trim()) ? '邮箱格式不对' : rows.some((r) => r.email === email.trim().toLowerCase()) ? '已经在名单里' : null;
  function add() {
    setTouched(true);
    if (error) return;
    setRows([{ email: email.trim().toLowerCase(), note: '—', added: '刚刚' }, ...rows]);
    setEmail(''); setTouched(false); toast('已加入注册名单', 'ok');
  }
  return (
    <Panel flush title="名单" description="只有名单里的邮箱能注册；注册后自动移出">
      <form className="flex items-start gap-2 border-b border-line px-4 py-3" noValidate onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Field label="添加邮箱" error={touched && email ? error : null} className="flex-1">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        </Field>
        <div className="mt-[26px]"><Button type="submit" variant="primary">添加</Button></div>
      </form>
      <table className="tbl"><tbody>{rows.map((r) => (
        <tr key={r.email}><td className="font-medium">{r.email}</td><td className="text-muted max-md:hidden">{r.note}</td><td className="text-muted">{r.added}</td>
          <td className="r"><Button size="xs" variant="ghost" onClick={() => setRemove(r.email)}>移除</Button></td></tr>
      ))}</tbody></table>
      <Confirm open={remove !== null} onOpenChange={(v) => { if (!v) setRemove(null); }} title="移出注册名单" action="移除"
        description={`${remove ?? ''} 将不能注册。已经注册的账号不受影响。`}
        onDone={() => setRows(rows.filter((r) => r.email !== remove))} doneText="已移除" />
    </Panel>
  );
}
