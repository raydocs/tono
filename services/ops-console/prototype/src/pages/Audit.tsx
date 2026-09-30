import { useState } from 'react';
import { Search } from 'lucide-react';
import { Badge, PageHeader, Panel, Segmented } from '@proto/ds';
import { dateTime } from '@proto/format';
import { AUDIT } from '@proto/mock/business';

type Filter = 'all' | 'publish' | 'customer' | 'node' | 'sensitive';
const GROUP: Record<string, Filter> = {
  'catalog.publish': 'publish', 'policy.publish': 'publish', 'release.publish': 'publish',
  'user.onboard': 'customer', 'user.patch': 'customer', 'home.assign': 'customer',
  'node.job': 'node', 'incident.ack': 'node',
  'diagnostics.open': 'sensitive', 'ledger.write': 'sensitive',
};

export default function Audit() {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const rows = AUDIT.filter((a) => filter === 'all' || GROUP[a.action] === filter).filter((a) => !q || `${a.summary} ${a.actor}`.includes(q));
  return (
    <div>
      <PageHeader title="审计" description="谁在什么时候做了什么。每个写操作、每次打开原始日志都在这里，不能删改。" />
      <Panel flush source="ops_audit"
        title={<Segmented<Filter> value={filter} onChange={setFilter} options={[
          { value: 'all', label: '全部' }, { value: 'publish', label: '发布' }, { value: 'customer', label: '客户' }, { value: 'node', label: '节点与事故' }, { value: 'sensitive', label: '日志与钱' },
        ]} />}
        actions={<label className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-muted"><Search size={12} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索内容或操作人" className="w-40 bg-transparent outline-none" /></label>}>
        <table className="tbl">
          <thead><tr><th>时间</th><th>操作人</th><th>角色</th><th>动作</th><th>内容</th><th>请求</th></tr></thead>
          <tbody>{rows.map((a) => (
            <tr key={a.id}>
              <td className="text-muted">{dateTime(a.at)}</td>
              <td>{a.actor}</td>
              <td><Badge tone={a.role === 'owner' ? 'info' : 'idle'}>{a.role}</Badge></td>
              <td className="num text-xs">{a.action}</td>
              <td className="max-w-md truncate">{GROUP[a.action] === 'sensitive' && <span className="mr-1.5"><Badge tone="warn">敏感</Badge></span>}{a.summary}</td>
              <td className="num text-xs text-faint">{a.requestId}</td>
            </tr>
          ))}</tbody>
        </table>
      </Panel>
    </div>
  );
}
