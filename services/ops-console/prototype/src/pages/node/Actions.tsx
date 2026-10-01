import { Confirm, KV } from '@proto/ds/overlay';
import { CUSTOMERS } from '@proto/mock/customers';
import type { FleetNode } from '@proto/mock/fleet';

type Props = { n: FleetNode; open: boolean; onOpenChange: (v: boolean) => void };

export function ProbeConfirm({ n, open, onOpenChange }: Props) {
  return (
    <Confirm open={open} onOpenChange={onOpenChange} title="重新探测" action="开始探测"
      description={`让 hub 立刻从电信、联通、移动三条线各探一次 ${n.name}，不影响在线客户。`}
      steps={['派发探测任务', '电信', '联通', '移动', '写入 ops_node_jobs']} doneText={`${n.name} 探测完成`} />
  );
}

export function RestartConfirm({ n, open, onOpenChange }: Props) {
  return (
    <Confirm open={open} onOpenChange={onOpenChange} title="重启 Xray" action="重启"
      description="hub 通过 SSH 在节点上执行 systemctl restart xray。身份和目录不变。"
      impact={<KV rows={[['在线客户', `${n.users} 位会断流约 3–5 秒，客户端自动重连`], ['上次重启', '95 分钟前 · 完成，4 秒'], ['需要角色', 'operator（nodes.jobs）']]} />}
      steps={['发送任务到 hub', 'hub 执行 restart', '等 Xray 恢复监听', '复测三网']} doneText={`${n.name} 已重启，三网复测完成`}
      failAt={n.status === 'sev' ? 3 : undefined}
      failText={<><div className="font-medium text-sev">Xray 已恢复，但三网仍然不通</div><div className="mt-0.5 text-muted">问题不在 Xray，更像 IP 被墙。建议下架，把 {n.users || 5} 位客户切到 Tokyo · Neon。</div></>} />
  );
}

export function DecommissionConfirm({ n, open, onOpenChange }: Props) {
  const moved = CUSTOMERS.filter((c) => c.node === n.name).length || n.users;
  return (
    <Confirm open={open} onOpenChange={onOpenChange} tone="danger" title="下架这台节点" action="下架" typed={n.name}
      description="从目录里移除这台节点并发布新目录。客户端在下次同步时换到其他节点；机器和身份保留，可以重新上架。"
      impact={(
        <div className="flex flex-col gap-2">
          <KV rows={[
            ['客户', `${moved} 位会被切到 Tokyo · Neon（空闲 4/10）`],
            ['目录', 'r40 → 草稿 r41，少 1 个出口'],
            ['节点', '停止 Xray，机器保留到到期日'],
            ['恢复', '重新上架会生成 r42'],
          ]} />
          <p className="text-xs text-muted">需要 owner 角色（nodes.write）。每一步写进审计。</p>
        </div>
      )}
      steps={['生成目录草稿 r41', '签名并发布目录', '等客户端同步（≤ 60 秒）', '停止 Xray']} doneText={`${n.name} 已下架，目录 r41 已发布`} />
  );
}
