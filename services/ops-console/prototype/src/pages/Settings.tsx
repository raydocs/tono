import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, Panel } from '@proto/ds';
import { Alerts } from './settings/Alerts';
import { Catalog } from './settings/Catalog';
import { Allowlist, Candidates, Providers } from './settings/Lists';
import { Policy } from './settings/Policy';

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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_1fr] lg:gap-6">
        <nav aria-label="设置分区" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0">
          {SECTIONS.map(([id, label, hint]) => (
            <a key={id} href={`#/settings/${id}`} aria-current={id === current ? 'page' : undefined}
              className={cn('shrink-0 rounded-md px-3 py-2', id === current ? 'bg-panel shadow-[0_0_0_1px_var(--line)]' : 'hover:bg-hover')}>
              <div className={cn('whitespace-nowrap text-sm', id === current ? 'font-medium' : 'text-muted')}>{label}</div>
              <div className="text-2xs text-faint max-lg:hidden">{hint}</div>
            </a>
          ))}
        </nav>
        <div className="min-w-0">
          <h2 className="mb-3 text-base font-semibold">{meta[1]}</h2>
          {current === 'catalog' && <Catalog />}
          {current === 'policy' && <Policy />}
          {current === 'alerts' && <Alerts />}
          {current === 'roles' && <Roles />}
          {current === 'candidates' && <Candidates />}
          {current === 'providers' && <Providers />}
          {current === 'allowlist' && <Allowlist />}
        </div>
      </div>
    </div>
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
          <tr key={what}><td>{what}</td>{cells.map((ok, i) => <td key={i} className="r">{ok ? <><Check size={14} className="inline text-ok" aria-hidden /><span className="sr-only">可以</span></> : <><Minus size={14} className="inline text-faint" aria-hidden /><span className="sr-only">不可以</span></>}</td>)}</tr>
        ))}</tbody>
      </table>
    </Panel>
  );
}
