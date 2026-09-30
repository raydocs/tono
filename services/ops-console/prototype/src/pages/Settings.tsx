import { useState } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge, Button, PageHeader, Panel } from '@proto/ds';
import { ago, NOW } from '@proto/format';
import { FLEET } from '@proto/mock/fleet';

const SECTIONS = [
  ['catalog', '目录', '客户端下次拉到的节点单子'],
  ['policy', '分流规则', '哪些站点不走隧道'],
  ['alerts', '告警', '什么情况下通知谁'],
  ['candidates', '直连候选', '从流量里挑出来的直连站点'],
  ['providers', '商家账号', '节点与家宽的供应商'],
  ['allowlist', '注册名单', '谁可以注册'],
  ['roles', '角色与权限', 'viewer / operator / owner'],
] as const;

type Section = (typeof SECTIONS)[number][0];

export default function Settings({ section }: { section: string | null }) {
  const current = (SECTIONS.find(([id]) => id === section)?.[0] ?? 'catalog') as Section;
  const meta = SECTIONS.find(([id]) => id === current)!;
  return (
    <div>
      <PageHeader title="设置" description="目录与分流规则只在这里发布；每次发布都要确认，并写进审计。" />
      <div className="grid grid-cols-[200px_1fr] gap-6">
        <nav className="flex flex-col gap-0.5">
          {SECTIONS.map(([id, label, hint]) => (
            <a key={id} href={`#/settings/${id}`} className={cn('rounded-md px-3 py-2', id === current ? 'bg-panel shadow-[0_0_0_1px_var(--line)]' : 'hover:bg-hover')}>
              <div className={cn('text-sm', id === current ? 'font-medium' : 'text-muted')}>{label}</div>
              <div className="text-2xs text-faint">{hint}</div>
            </a>
          ))}
        </nav>
        <div className="min-w-0">
          <h2 className="mb-3 text-base font-semibold">{meta[1]}</h2>
          {current === 'catalog' && <Catalog />}
          {current === 'policy' && <Policy />}
          {current === 'alerts' && <Alerts />}
          {current === 'roles' && <Roles />}
          {(current === 'candidates' || current === 'providers' || current === 'allowlist') && <Simple kind={current} />}
        </div>
      </div>
    </div>
  );
}

const YAML = FLEET.filter((n) => n.listed && n.name !== 'Catalog Only').slice(0, 7).map((n) => `  - name: "${n.name}"\n    server: {{ ${n.name.split(' · ')[1]?.toUpperCase()}_HOST }}\n    type: vless\n    reality-opts: { public-key: {{ PBK }} }`).join('\n');

function Catalog() {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const text = `proxies:\n${YAML}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-3">
        {[['线上版本', 'r40'], ['发布于', ago(NOW - 4300 * 60_000)], ['节点', '16 台 · 17 部署'], ['客户端拉到最新', '47 / 51']].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-panel px-4 py-3"><div className="text-xs text-muted">{k}</div><div className="mt-1 text-lg font-semibold num">{v}</div></div>
        ))}
      </div>
      <Panel title="catalog.yaml" description={editing ? '草稿 · 基于 r40 · +2 / −1 行' : '只读 · 点编辑开始改；占位符原样保留'} source="managed_exit_catalog"
        actions={editing ? <><Button size="xs" variant="ghost" onClick={() => setEditing(false)}>放弃</Button><Button size="xs" variant="primary" onClick={() => setConfirm(true)}>对照差异发布</Button></> : <Button size="xs" onClick={() => setEditing(true)}>编辑</Button>} flush>
        <pre className="max-h-96 overflow-auto p-0 text-xs leading-5">
          {text.split('\n').map((line, i) => (
            <div key={i} className={cn('flex', editing && i === 3 && 'bg-sev-soft', editing && (i === 4 || i === 5) && 'bg-ok-soft')}>
              <span className="w-10 shrink-0 select-none pr-3 text-right text-faint num">{i + 1}</span>
              <code className="num whitespace-pre">{editing && (i === 4 || i === 5) ? '+ ' : editing && i === 3 ? '- ' : '  '}{line}</code>
            </div>
          ))}
        </pre>
      </Panel>
      <Panel title="历史版本" description="只存摘要，不存原文" flush>
        <table className="tbl">
          <thead><tr><th>版本</th><th>发布于</th><th>内容</th><th>sha256</th><th>发布人</th></tr></thead>
          <tbody>{[40, 39, 38, 37].map((r, i) => (
            <tr key={r}><td className="num">r{r} {i === 0 && <Badge tone="ok">线上</Badge>}</td><td className="text-muted">{ago(NOW - (4300 + i * 2900) * 60_000)}</td><td className="text-muted">{16 - i} 台 · {17 - i} 部署</td><td className="num text-xs text-faint">{(0x9f3ab2c1 + r * 7919).toString(16)}…</td><td className="text-muted">ray@tono.dev</td></tr>
          ))}</tbody>
        </table>
      </Panel>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发布目录 r41</DialogTitle>
            <DialogDescription>基于 r40，+2 / −1 行。发布后客户端下次同步就会拿到新单子；如果这期间有人发布了 r41，会被拒绝并保留你的草稿。</DialogDescription>
          </DialogHeader>
          <ul className="rounded-md border border-line text-sm">
            <li className="flex justify-between border-b border-line px-3 py-2"><span className="text-muted">新增</span><span>Osaka · Kansai</span></li>
            <li className="flex justify-between px-3 py-2"><span className="text-muted">移除</span><span>Buffalo · Erie（到期未续）</span></li>
          </ul>
          <DialogFooter><Button onClick={() => setConfirm(false)}>取消</Button><Button variant="primary" onClick={() => { setConfirm(false); setEditing(false); }}>确认发布</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Policy() {
  return (
    <div className="flex flex-col gap-4">
      <Panel title="当前规则 r4" description="签名后下发；保存前先预演，看有多少客户端会重连" source="managed_traffic_policy">
        <div className="grid grid-cols-3 gap-3 text-sm">
          {[['网页直连', '0 个域名', '已关闭'], ['原生应用直连', '38 个', '开启'], ['TCP 端点', '12 个', '开启']].map(([k, v, s]) => (
            <div key={k} className="rounded-md border border-line px-3 py-2.5"><div className="text-muted">{k}</div><div className="mt-0.5 font-medium num">{v}</div><div className="text-xs text-faint">{s}</div></div>
          ))}
        </div>
        <div className="mt-4 flex gap-2"><Button>编辑 JSON</Button><Button>预演</Button><Button variant="danger">关闭网页直连</Button><Button variant="danger">关掉全部直连</Button></div>
      </Panel>
    </div>
  );
}

function Alerts() {
  const rules = [
    ['节点被墙或失联', '严重', '持续 15 分钟', 'Telegram · 值班群', true],
    ['连接成功率低于 97%', '注意', '持续 30 分钟', 'Telegram · 值班群', true],
    ['失败聚类新开或 5 倍尖峰', '注意', '立即', 'Webhook · 工程机器人', false],
    ['家宽失联', '注意', '持续 30 分钟', 'Telegram · ray', true],
  ] as const;
  return (
    <Panel title="规则" description="延迟与冷却防止刷屏；测试发送不影响计数" source="ops_alert_rules" flush actions={<Button size="xs" variant="primary">新建规则</Button>}>
      <table className="tbl">
        <thead><tr><th>条件</th><th>级别</th><th>触发</th><th>发给</th><th>状态</th><th /></tr></thead>
        <tbody>{rules.map(([what, level, when, to, on]) => (
          <tr key={what}><td>{what}</td><td><Badge tone={level === '严重' ? 'sev' : 'warn'}>{level}</Badge></td><td className="text-muted">{when}</td><td className="text-muted">{to}</td><td>{on ? <Badge tone="ok" dot>启用</Badge> : <Badge dot>等 #707</Badge>}</td><td className="r"><Button size="xs" variant="ghost">测试发送</Button></td></tr>
        ))}</tbody>
      </table>
    </Panel>
  );
}

const MATRIX: [string, boolean, boolean, boolean][] = [
  ['看节点、客户、事故', true, true, true],
  ['处理事故、开通与续期客户', false, true, true],
  ['看设置与审计', false, true, true],
  ['登记与发布客户端版本', false, true, true],
  ['发布目录 / 分流规则 / 家宽库存', false, false, true],
  ['上架、下架出口节点', false, false, true],
  ['读原始网络日志', false, false, true],
  ['账本与关账', false, false, true],
];

function Roles() {
  return (
    <Panel title="角色能做什么" description="服务端按同一张表拦截（OPS_ROLES）；没列出的接口只有 owner 能用" source="OPS_ROLES" flush>
      <table className="tbl">
        <thead><tr><th>动作</th><th className="r">viewer</th><th className="r">operator</th><th className="r">owner</th></tr></thead>
        <tbody>{MATRIX.map(([what, ...cells]) => (
          <tr key={what}><td>{what}</td>{cells.map((ok, i) => <td key={i} className="r">{ok ? <Check size={14} className="inline text-ok" /> : <Minus size={14} className="inline text-faint" />}</td>)}</tr>
        ))}</tbody>
      </table>
    </Panel>
  );
}

function Simple({ kind }: { kind: 'candidates' | 'providers' | 'allowlist' }) {
  const rows = kind === 'candidates'
    ? [['bilibili.com', '14 位客户 · 2.1 GB', '国内 CDN'], ['qq.com', '11 位客户 · 640 MB', '国内'], ['zhihu.com', '6 位客户 · 120 MB', '国内']]
    : kind === 'providers'
      ? [['DMIT', '4 台节点', '美元 · 月付'], ['Vultr', '5 台节点', '美元 · 月付'], ['IPRoyal', '8 条家宽', '美元 · 月付']]
      : [['new.user@gmail.com', '微信 wx_new_user', '3 天前加入'], ['studio.east@qq.com', '—', '昨天加入']];
  return (
    <Panel flush title={kind === 'candidates' ? '待决定' : kind === 'providers' ? '账号' : '名单'} actions={<Button size="xs" variant="primary">{kind === 'candidates' ? '生成规则草稿' : '添加'}</Button>}>
      <table className="tbl"><tbody>{rows.map((r) => (
        <tr key={r[0]}><td className="font-medium">{r[0]}</td><td className="text-muted">{r[1]}</td><td className="text-muted">{r[2]}</td>
          <td className="r space-x-1">{kind === 'candidates' ? <><Button size="xs">接受</Button><Button size="xs" variant="ghost">拒绝</Button></> : <Button size="xs" variant="ghost">编辑</Button>}</td></tr>
      ))}</tbody></table>
    </Panel>
  );
}
