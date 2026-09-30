import { useState } from 'react';
import { Search } from 'lucide-react';
import { Badge, Button, PageHeader, Panel, Segmented } from '@proto/ds';
import { Code, Diff, Drawer, KV, Section } from '@proto/ds/overlay';
import { dateTime } from '@proto/format';
import { rowProps } from '@proto/keys';
import { AUDIT } from '@proto/mock/business';
import { auditDetail } from '@proto/mock/details';
import { useHashParam } from '@proto/state';

type Filter = 'all' | 'publish' | 'customer' | 'node' | 'sensitive';
const GROUP: Record<string, Filter> = {
  'catalog.publish': 'publish', 'policy.publish': 'publish', 'release.publish': 'publish',
  'user.onboard': 'customer', 'user.patch': 'customer', 'home.assign': 'customer',
  'node.job': 'node', 'incident.ack': 'node',
  'diagnostics.open': 'sensitive', 'ledger.write': 'sensitive',
};

type Row = (typeof AUDIT)[number];

function AuditDrawer({ row, onClose }: { row: Row | undefined; onClose: () => void }) {
  if (!row) return <Drawer open={false} onOpenChange={onClose} title="">{null}</Drawer>;
  const d = auditDetail(row.action, row.id);
  return (
    <Drawer open onOpenChange={(v) => { if (!v) onClose(); }} title={row.summary} subtitle={`${dateTime(row.at)} · ${row.actor}`}
      meta={<><Badge tone={row.role === 'owner' ? 'info' : 'idle'}>{row.role}</Badge><Badge tone="ok">{d.status}</Badge>{GROUP[row.action] === 'sensitive' && <Badge tone="warn">敏感</Badge>}</>}
      footer={<Button onClick={onClose}>关闭</Button>}>
      <Section title="改了什么">
        {d.diff.length ? <Diff rows={d.diff} /> : <p className="text-sm text-muted">这个动作没有字段变更。</p>}
      </Section>
      <Section title="请求">
        <KV rows={[
          ['方法与路径', <span key="p" className="num text-xs"><span className="mr-1.5 rounded bg-hover px-1 font-medium">{d.method}</span>{d.path}</span>],
          ['请求 ID', <span key="r" className="num text-xs">{row.requestId}</span>],
          ['来源', d.ip], ['浏览器', d.agent], ['动作', <span key="a" className="num text-xs">{row.action}</span>],
        ]} />
      </Section>
      <Section title="原始记录">
        <Code label="ops_audit" value={{ id: row.id, at: new Date(row.at).toISOString(), actor: row.actor, role: row.role, action: row.action, request_id: row.requestId, method: d.method, path: d.path, status: d.status, diff: d.diff }} />
      </Section>
      <p className="text-xs text-muted">审计只追加，不能改也不能删。要撤回一次改动，做一次反向操作，它会在这里另记一行。</p>
    </Drawer>
  );
}

export default function Audit() {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [id, setId] = useHashParam('id');
  const rows = AUDIT.filter((a) => filter === 'all' || GROUP[a.action] === filter).filter((a) => !q || `${a.summary} ${a.actor}`.includes(q));
  return (
    <div>
      <PageHeader title="审计" description="谁在什么时候做了什么。每个写操作、每次打开原始日志都在这里，不能删改。点一行看改前改后。" />
      <Panel flush source="ops_audit"
        title={<Segmented<Filter> label="按类型筛选" value={filter} onChange={setFilter} options={[
          { value: 'all', label: '全部' }, { value: 'publish', label: '发布' }, { value: 'customer', label: '客户' }, { value: 'node', label: '节点与事故' }, { value: 'sensitive', label: '日志与钱' },
        ]} />}
        actions={<label className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-muted focus-within:border-accent"><Search size={12} aria-hidden /><input data-search aria-label="搜索审计" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索内容或操作人" className="w-40 bg-transparent outline-none focus-visible:outline-none" /></label>}>
        <table className="tbl">
          <thead><tr><th>时间</th><th>操作人</th><th className="max-md:hidden">角色</th><th className="max-lg:hidden">动作</th><th>内容</th><th className="max-xl:hidden">请求</th></tr></thead>
          <tbody>{rows.map((a) => (
            <tr key={a.id} {...rowProps(() => setId(a.id), a.summary)} aria-selected={id === a.id || undefined}>
              <td className="text-muted whitespace-nowrap">{dateTime(a.at)}</td>
              <td>{a.actor}</td>
              <td className="max-md:hidden"><Badge tone={a.role === 'owner' ? 'info' : 'idle'}>{a.role}</Badge></td>
              <td className="num text-xs max-lg:hidden">{a.action}</td>
              <td className="max-w-md truncate">{GROUP[a.action] === 'sensitive' && <span className="mr-1.5"><Badge tone="warn">敏感</Badge></span>}{a.summary}</td>
              <td className="num text-xs text-faint max-xl:hidden">{a.requestId}</td>
            </tr>
          ))}</tbody>
        </table>
      </Panel>
      <AuditDrawer row={AUDIT.find((a) => a.id === id)} onClose={() => setId(null)} />
    </div>
  );
}
