import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge, Button, Panel } from '@proto/ds';
import { Confirm, KV } from '@proto/ds/overlay';
import { ago, NOW } from '@proto/format';
import { FLEET } from '@proto/mock/fleet';

const YAML = FLEET.filter((n) => n.listed && n.name !== 'Catalog Only').slice(0, 7).map((n) => `  - name: "${n.name}"\n    server: {{ ${n.name.split(' · ')[1]?.toUpperCase()}_HOST }}\n    type: vless\n    reality-opts: { public-key: {{ PBK }} }`).join('\n');

export function Catalog() {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [live, setLive] = useState(40);
  const text = `proxies:\n${YAML}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['线上版本', `r${live}`], ['发布于', live > 40 ? '刚刚' : ago(NOW - 4300 * 60_000)], ['节点', '16 台 · 17 部署'], ['客户端拉到最新', live > 40 ? '0 / 51' : '47 / 51']].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-panel px-4 py-3"><div className="text-xs text-muted">{k}</div><div className="mt-1 text-lg font-semibold num">{v}</div></div>
        ))}
      </div>
      <Panel title="catalog.yaml" description={editing ? `草稿 · 基于 r${live} · +2 / −1 行` : '只读 · 点编辑开始改；占位符原样保留'} source="managed_exit_catalog"
        actions={editing ? <><Button size="xs" variant="ghost" onClick={() => setEditing(false)}>放弃</Button><Button size="xs" variant="primary" onClick={() => setConfirm(true)}>对照差异发布</Button></> : <Button size="xs" onClick={() => setEditing(true)}>编辑</Button>} flush>
        <pre tabIndex={0} className="max-h-96 overflow-auto p-0 text-xs leading-5" aria-label="catalog.yaml">
          {text.split('\n').map((line, i) => (
            <div key={i} className={cn('flex', editing && i === 3 && 'bg-sev-soft', editing && (i === 4 || i === 5) && 'bg-ok-soft')}>
              <span className="w-10 shrink-0 select-none pr-3 text-right text-faint num" aria-hidden>{i + 1}</span>
              <code className="num whitespace-pre">{editing && (i === 4 || i === 5) ? '+ ' : editing && i === 3 ? '- ' : '  '}{line}</code>
            </div>
          ))}
        </pre>
      </Panel>
      <Panel title="历史版本" description="只存摘要，不存原文" flush>
        <table className="tbl">
          <thead><tr><th>版本</th><th>发布于</th><th className="max-md:hidden">内容</th><th className="max-lg:hidden">sha256</th><th>发布人</th></tr></thead>
          <tbody>{[40, 39, 38, 37].map((r, i) => (
            <tr key={r}><td className="num">r{r} {r === live && <Badge tone="ok">线上</Badge>}</td><td className="text-muted">{ago(NOW - (4300 + i * 2900) * 60_000)}</td><td className="text-muted max-md:hidden">{16 - i} 台 · {17 - i} 部署</td><td className="num text-xs text-faint max-lg:hidden">{(0x9f3ab2c1 + r * 7919).toString(16)}…</td><td className="text-muted">ray@tono.dev</td></tr>
          ))}</tbody>
        </table>
      </Panel>
      <Confirm open={confirm} onOpenChange={setConfirm} title={`发布目录 r${live + 1}`} action="确认发布"
        description={`基于 r${live}，+2 / −1 行。如果这期间有人发布了 r${live + 1}，会被拒绝并保留你的草稿。`}
        impact={<KV rows={[['新增', 'Osaka · Kansai'], ['移除', 'Buffalo · Erie（到期未续）'], ['受影响', '3 位客户在 Buffalo · Erie 上，下次同步换节点']]} />}
        steps={['校验占位符', '签名', '写入 managed_exit_catalog', '通知客户端']} doneText={`目录 r${live + 1} 已发布`}
        onDone={() => { setLive(live + 1); setEditing(false); }} />
    </div>
  );
}
