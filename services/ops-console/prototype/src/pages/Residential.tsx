import { useState } from 'react';
import { Plus, Upload } from 'lucide-react';
import { ProbeStrip } from '@proto/charts/small';
import { Badge, Button, Dot, PageHeader, Panel, Segmented, Stat } from '@proto/ds';
import { cny, DAY, NOW, pct, until } from '@proto/format';
import { CLAUDE_ACCOUNTS, HOME_EXITS, type HomeExit } from '@proto/mock/business';
import { customerById } from '@proto/mock/customers';
import { useHashParam } from '@proto/state';
import { AddDrawer, BindDrawer, ImportDrawer } from './residential/Dialogs';

type Filter = 'all' | 'bound' | 'idle' | 'dead';

const HEALTH: Record<HomeExit['health'], { label: string; tone: 'ok' | 'warn' | 'sev' }> = {
  alive: { label: '正常', tone: 'ok' }, flaky: { label: '时断时续', tone: 'warn' }, dead: { label: '失联', tone: 'sev' },
};

export default function Residential() {
  const [filter, setFilter] = useState<Filter>('all');
  const [focus] = useHashParam('focus');
  const [bind, setBind] = useHashParam('bind');
  const [dialog, setDialog] = useState<'import' | 'add' | null>(null);
  const ids = HOME_EXITS.map((h) => h.id);
  const bound = HOME_EXITS.filter((h) => h.boundTo);
  const idle = HOME_EXITS.filter((h) => !h.boundTo && h.health !== 'dead');
  const dead = HOME_EXITS.filter((h) => h.health === 'dead');
  const rows = filter === 'all' ? HOME_EXITS : filter === 'bound' ? bound : filter === 'idle' ? idle : dead;
  const cost = HOME_EXITS.reduce((a, h) => a + h.costMinor, 0);
  const idleCost = idle.reduce((a, h) => a + h.costMinor, 0);

  return (
    <div>
      <PageHeader title="家宽出口" description="能不能用、给了谁、花多少钱在同一行。取代原来分开的「家宽库存」和「家宽资产」。"
        actions={<><Button icon={<Upload size={14} />} onClick={() => setDialog('import')}>批量导入</Button><Button variant="primary" icon={<Plus size={14} />} onClick={() => setDialog('add')}>登记家宽</Button></>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="家宽" value={String(HOME_EXITS.length)} />
        <Stat label="已绑定客户" value={String(bound.length)} tone="ok" />
        <Stat label="闲置" value={String(idle.length)} tone="warn" sub={`每月空花 ${cny(idleCost)}`} />
        <Stat label="失联" value={String(dead.length)} tone="sev" />
        <Stat label="月成本" value={cny(cost)} sub={`利用率 ${pct(bound.length / HOME_EXITS.length, 0)}`} />
        <Stat label="Claude 账号" value={`${CLAUDE_ACCOUNTS.bound}/${CLAUDE_ACCOUNTS.total}`} sub={`闲置 ${CLAUDE_ACCOUNTS.idle} · 封禁 ${CLAUDE_ACCOUNTS.banned}`} />
      </div>

      <Panel className="mt-4" flush source="home_exits · operations_home_probe_samples" ageMin={12} staleAfter={30}
        title={<Segmented<Filter> label="按状态筛选" value={filter} onChange={setFilter} options={[
          { value: 'all', label: '全部', count: HOME_EXITS.length }, { value: 'bound', label: '在用', count: bound.length },
          { value: 'idle', label: '闲置', count: idle.length }, { value: 'dead', label: '失联', count: dead.length },
        ]} />}>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>家宽</th><th>健康</th><th className="max-lg:hidden">探测 · 24 小时</th><th>给了谁</th><th className="max-xl:hidden">Claude</th><th className="max-xl:hidden">商家</th><th className="r max-md:hidden">月租</th><th className="r max-md:hidden">续费</th><th><span className="sr-only">操作</span></th></tr></thead>
            <tbody>{rows.map((h) => {
              const who = h.boundTo ? customerById(h.boundTo) : null;
              return (
                <tr key={h.id} aria-selected={focus === h.id || bind === h.id || undefined} ref={focus === h.id ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined}>
                  <td><div className="font-medium">{h.id}</div><div className="text-xs text-faint">{h.label} · <span className="num">{h.ipPrefix}</span></div></td>
                  <td><span className="inline-flex items-center gap-1.5"><Dot tone={HEALTH[h.health].tone} />{HEALTH[h.health].label}</span></td>
                  <td className="max-lg:hidden"><ProbeStrip probes={h.probes} height={16} /></td>
                  <td>{who ? <a className="hover:underline" href={`#/customers/${who.id}`}>{who.email}</a> : <Badge tone="warn">闲置</Badge>}</td>
                  <td className="text-muted max-xl:hidden">{h.claudeAccount ?? '—'}</td>
                  <td className="text-muted max-xl:hidden">{h.vendor}</td>
                  <td className="r num max-md:hidden">{cny(h.costMinor)}</td>
                  <td className={`r max-md:hidden ${h.renewAt - NOW < 7 * DAY ? 'text-warn' : 'text-muted'}`}>{until(h.renewAt)}</td>
                  <td className="r"><Button size="xs" variant={who ? 'ghost' : 'default'} onClick={() => setBind(h.id)} disabled={h.health === 'dead'}>{who ? '换绑' : '绑定'}</Button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </Panel>
      <BindDrawer h={HOME_EXITS.find((h) => h.id === bind)} onClose={() => setBind(null)} />
      <ImportDrawer open={dialog === 'import'} onOpenChange={(v) => setDialog(v ? 'import' : null)} existing={ids} />
      <AddDrawer open={dialog === 'add'} onOpenChange={(v) => setDialog(v ? 'add' : null)} existing={ids} />
    </div>
  );
}
