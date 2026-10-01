import { useState } from 'react';
import { Badge, Button, Kbd, Panel } from '@proto/ds';
import { Checkbox, Field, Input, Select, Switch, Textarea } from '@proto/ds/forms';
import { Code, Confirm, Diff, Drawer, KV, Section, useToast } from '@proto/ds/overlay';
import { SHORTCUTS } from '@proto/keys';

export function FormSpec() {
  const [on, setOn] = useState(true);
  const [c, setC] = useState(true);
  return (
    <Panel title="表单" description="标签在上，说明在标签下；出错时错误替换说明，不叠加。高 32，圆角 6，焦点环 2 px 强调色。">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="邮箱" required hint="登录名，也是账单上的名字。"><Input placeholder="name@example.com" /></Field>
        <Field label="邮箱" required error="邮箱格式不对"><Input defaultValue="chen.jie@" /></Field>
        <Field label="时长"><Select defaultValue="3" options={[{ value: '1', label: '1 个月' }, { value: '3', label: '3 个月' }]} /></Field>
        <Field label="不可编辑" hint="只读字段用禁用态，不用灰色文字冒充。"><Input disabled defaultValue="r40 · 线上" /></Field>
        <Field label="备注" hint="客户看不到，写进审计。" className="md:col-span-2"><Textarea rows={2} placeholder="例如：微信转账 9/30 已收" /></Field>
        <div className="flex items-center justify-between rounded-md border border-line px-3 py-2.5">
          <div><div className="text-sm font-medium">开关</div><div className="text-xs text-muted">立即生效的布尔项，role=switch</div></div>
          <Switch checked={on} onChange={setOn} label="开关示例" />
        </div>
        <label className="flex items-center gap-2 rounded-md border border-line px-3 py-2.5 text-sm"><Checkbox checked={c} onChange={setC} label="复选示例" />复选：多选与批量，表头可半选</label>
      </div>
      <ul className="mt-4 grid gap-1 text-xs text-muted md:grid-cols-2">
        <li>· 失焦或点提交后才显示错误；改对了立即消失</li>
        <li>· 提交按钮在有错误时禁用，并写明哪一项不对</li>
        <li>· 密码、API key 不进表单，走 Worker secret</li>
        <li>· 金额按分存，输入按元；汇率在关账时快照</li>
      </ul>
    </Panel>
  );
}

export function OverlaySpec() {
  const toast = useToast();
  const [drawer, setDrawer] = useState<null | 'narrow' | 'wide'>(null);
  const [confirm, setConfirm] = useState<null | 'plain' | 'danger' | 'typed'>(null);
  return (
    <Panel title="抽屉、确认与提示" description="看详情用抽屉（列表留在背后），改东西用确认框，结果用提示。三者的 URL、焦点和 Esc 行为一致。">
      <div className="grid gap-6 lg:grid-cols-3">
        <div>
          <h3 className="mb-2 text-sm font-medium">抽屉</h3>
          <ul className="mb-3 flex flex-col gap-1 text-xs text-muted">
            <li>· 右侧滑出；520 px 放一条记录，720 px 放带表格的记录；640 px 以下全宽</li>
            <li>· 头：标题 + 一行说明 + 徽章；身：分节，节标题 12 px 大写；脚：右对齐按钮</li>
            <li>· 主题写进 URL（<span className="num">?code=</span>、<span className="num">?event=</span>），能贴到群里；关闭不留历史</li>
            <li>· 打开时焦点进抽屉（表单抽屉进第一个输入框），关闭后回到触发的那一行</li>
          </ul>
          <div className="flex gap-2"><Button onClick={() => setDrawer('narrow')}>520 抽屉</Button><Button onClick={() => setDrawer('wide')}>720 抽屉</Button></div>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium">确认的三个级别</h3>
          <ul className="mb-3 flex flex-col gap-1 text-xs text-muted">
            <li>· 普通：一次点击，写清会发生什么（重新探测、测试发送）</li>
            <li>· 危险：红色按钮，列出影响的客户和数量（重启、撤回、冲正）</li>
            <li>· 不可逆：先输入对象的名字（下架节点、停用客户、关账）</li>
            <li>· 确认后同一个框里显示任务步骤，跑完才出现「完成」；进行中不能关</li>
          </ul>
          <div className="flex flex-wrap gap-2"><Button onClick={() => setConfirm('plain')}>普通</Button><Button variant="danger" onClick={() => setConfirm('danger')}>危险</Button><Button variant="danger" onClick={() => setConfirm('typed')}>不可逆</Button></div>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium">提示</h3>
          <ul className="mb-3 flex flex-col gap-1 text-xs text-muted">
            <li>· 右下角，3 秒消失，最多叠 3 条；role=status，读屏器会念</li>
            <li>· 只报结果（「已续期到 12/30」），不报过程；过程放在确认框里</li>
            <li>· 失败不用提示，用确认框里的失败步骤，并保留草稿</li>
          </ul>
          <div className="flex gap-2"><Button onClick={() => toast('已续期到 2026-12-30', 'ok')}>成功</Button><Button onClick={() => toast('目录 r41 已被别人发布，草稿已保留', 'warn')}>冲突</Button></div>
        </div>
      </div>
      <Drawer open={drawer !== null} onOpenChange={(v) => { if (!v) setDrawer(null); }} wide={drawer === 'wide'} title="TLS_HANDSHAKE_TIMEOUT" subtitle="过去 24 小时 412 次 · 5 位客户"
        meta={<><Badge tone="sev">严重</Badge><Badge>connection_events</Badge></>} footer={<><Button onClick={() => setDrawer(null)}>关闭</Button><Button variant="primary">去 Los Angeles · Mesa</Button></>}>
        <Section title="键值"><KV rows={[['最近一次', '2 分钟前'], ['集中在', 'Los Angeles · Mesa · 联通'], ['客户端', 'Windows 1.4.2']]} /></Section>
        <Section title="改前改后"><Diff rows={[{ field: 'revision', before: 'r40', after: 'r41' }, { field: 'proxies[+]', before: null, after: 'Osaka · Kansai' }]} /></Section>
        <Section title="原始记录"><Code value={{ event_id: 'ev_01J9Z', error_code: 'TLS_HANDSHAKE_TIMEOUT', elapsed_ms: 10000 }} /></Section>
      </Drawer>
      <Confirm open={confirm === 'plain'} onOpenChange={(v) => { if (!v) setConfirm(null); }} title="重新探测" description="hub 立刻从三网各探一次，不影响在线客户。" action="开始探测" steps={['派发任务', '电信', '联通', '移动']} />
      <Confirm open={confirm === 'danger'} onOpenChange={(v) => { if (!v) setConfirm(null); }} tone="danger" title="重启 Xray" description="在线客户会断流 3–5 秒。" impact="Los Angeles · Mesa 上 5 位客户会重连一次" action="重启" steps={['发送任务', 'hub 执行', '等 Xray 恢复', '复测三网']} />
      <Confirm open={confirm === 'typed'} onOpenChange={(v) => { if (!v) setConfirm(null); }} tone="danger" title="下架这台节点" description="从目录移除并发布新目录。" impact="5 位客户会被切到 Tokyo · Neon；目录 r40 → r41" action="下架" typed="Los Angeles · Mesa" steps={['生成目录草稿 r41', '签名并发布', '等客户端同步', '停止 Xray']} />
    </Panel>
  );
}

const CONTRAST: [string, string, string, string][] = [
  ['正文 fg / panel', '18.0 : 1', '16.0 : 1', '正文'],
  ['次要 muted / panel', '6.6 : 1', '7.6 : 1', '说明'],
  ['弱 faint / panel', '5.6 : 1', '5.5 : 1', '坐标轴、数据源；选中行底色上 ≥ 4.6'],
  ['正常 ok / panel', '6.0 : 1', '9.6 : 1', '状态文字'],
  ['注意 warn / panel', '5.6 : 1', '9.2 : 1', '状态文字'],
  ['故障 sev / panel', '5.7 : 1', '5.8 : 1', '状态文字'],
  ['信息 info / panel', '6.7 : 1', '6.9 : 1', '状态文字'],
  ['按钮 accent-fg / accent', '5.5 : 1', '6.1 : 1', '主按钮'],
];

export function AccessSpec() {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Panel title="键盘" description="一个监听器管全站；输入时和打开浮层时不触发" flush>
        <table className="tbl"><tbody>{SHORTCUTS.map((s) => (
          <tr key={s.what}><td className="whitespace-nowrap">{s.keys.map((k) => (k === '然后' ? <span key={k} className="mx-1 text-xs text-faint">然后</span> : <Kbd key={k}>{k}</Kbd>))}</td><td className="text-muted">{s.what}</td></tr>
        ))}</tbody></table>
      </Panel>
      <Panel title="断点" description="按运维真实用的屏幕定，而不是按设备" flush>
        <table className="tbl">
          <thead><tr><th>宽度</th><th>导航</th><th>表格</th></tr></thead>
          <tbody>
            <tr><td className="num">≥ 1280</td><td>完整侧栏 224 px</td><td className="text-muted">全部列</td></tr>
            <tr><td className="num">1024–1279</td><td>图标栏 56 px，悬停出名字</td><td className="text-muted">隐藏低优先列（负载、到期、请求 ID）</td></tr>
            <tr><td className="num">768–1023</td><td>图标栏</td><td className="text-muted">再隐藏 sparkline、签名、说明</td></tr>
            <tr><td className="num">&lt; 768</td><td>汉堡菜单滑出</td><td className="text-muted">只留名字、状态、一个关键数；横向可滚</td></tr>
          </tbody>
        </table>
        <p className="px-4 py-3 text-xs text-muted">时间范围在 640 以下收进「原型控制」菜单；统计卡片 2 列；抽屉全宽。</p>
      </Panel>
      <Panel title="对比度" description="WCAG AA：正文 ≥ 4.5 : 1；状态色也按正文算" flush>
        <table className="tbl">
          <thead><tr><th>组合</th><th className="r">浅色</th><th className="r">深色</th></tr></thead>
          <tbody>{CONTRAST.map(([k, l, d, use]) => (
            <tr key={k}><td><div>{k}</div><div className="text-2xs text-faint">{use}</div></td><td className="r num">{l}</td><td className="r num">{d}</td></tr>
          ))}</tbody>
        </table>
        <p className="px-4 py-3 text-xs text-muted">焦点环 2 px 强调色；行聚焦时整行底色加左侧强调条。动效在「减少动态效果」下关闭。颜色从不单独表达状态，总配文字或图形。</p>
      </Panel>
    </div>
  );
}
