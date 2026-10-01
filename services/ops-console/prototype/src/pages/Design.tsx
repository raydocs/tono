import { Plus } from 'lucide-react';
import { LineChart } from '@proto/charts/LineChart';
import { Bars, Heatmap, Meter, ProbeStrip, Spark } from '@proto/charts/small';
import { SERIES_COLORS } from '@proto/charts/core';
import { Badge, Button, Dot, Empty, ErrorState, Freshness, Legend, Loading, NotWired, PageHeader, Panel, Segmented, Stat, type Tone } from '@proto/ds';
import { pct } from '@proto/format';
import { successSeries } from '@proto/mock/observe';
import { useProto } from '@proto/state';
import { AccessSpec, FormSpec, OverlaySpec } from './design/Specs';

const TYPE = [
  { cls: 'text-3xl font-semibold tracking-tight', px: '32 / 600', use: '首页结论' },
  { cls: 'text-2xl font-semibold tracking-tight', px: '24 / 600', use: '统计数字' },
  { cls: 'text-xl font-semibold tracking-tight', px: '20 / 600', use: '页面标题' },
  { cls: 'text-sm font-medium', px: '14 / 500', use: '面板标题、正文' },
  { cls: 'text-xs text-muted', px: '12 / 400', use: '表格、说明' },
  { cls: 'text-2xs text-faint', px: '11 / 400', use: '坐标轴、数据源' },
];

const SURFACES = ['bg', 'panel', 'panel-2', 'hover', 'line', 'line-strong', 'fg', 'muted', 'faint', 'accent', 'accent-soft'];
const STATUS: { tone: Tone; name: string; use: string }[] = [
  { tone: 'ok', name: '正常', use: '可连、在线、达标' },
  { tone: 'warn', name: '注意', use: '接近阈值、陈旧、将到期' },
  { tone: 'sev', name: '故障', use: '用户正在受影响' },
  { tone: 'info', name: '信息', use: '进行中、已确认' },
  { tone: 'idle', name: '闲置', use: '未启用、未上报、无数据' },
];
const SPACE = [4, 8, 12, 16, 24, 32];

function Swatch({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-8 w-8 shrink-0 rounded-md border border-line" style={{ background: `var(--${name})` }} />
      <span className="text-xs num">--{name}</span>
    </div>
  );
}

export default function Design() {
  const { range } = useProto();
  const a = successSeries('design-a', range, 0.99);
  const b = successSeries('design-b', range, 0.975, false);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="设计规范" description="所有页面只用这里的组件和变量。换主题只换变量，组件不写颜色。" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="字号" description="Geist + 系统中文字体；数字用等宽数字">
          <div className="flex flex-col gap-3">
            {TYPE.map((t) => (
              <div key={t.px} className="flex items-baseline gap-4">
                <span className="w-20 shrink-0 text-2xs text-faint num">{t.px}</span>
                <span className={t.cls}>{t.use === '统计数字' ? '99.12%' : t.use}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="间距与圆角" description="4 的倍数；面板内边距 16，面板间距 16">
          <div className="flex flex-col gap-4">
            <div className="flex items-end gap-3">
              {SPACE.map((s) => (
                <div key={s} className="flex flex-col items-center gap-1">
                  <span className="bg-accent-soft" style={{ width: s, height: s }} />
                  <span className="text-2xs text-faint num">{s}</span>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-3">
              {[['sm', 4], ['md', 6], ['lg', 8], ['xl', 12]].map(([n, r]) => (
                <div key={n} className="flex flex-col items-center gap-1">
                  <span className="h-10 w-14 border border-line-strong bg-panel-2" style={{ borderRadius: Number(r) }} />
                  <span className="text-2xs text-faint">{n} · {r}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="颜色" description="浅色和深色各一套；右上角切换主题查看另一套">
        <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{SURFACES.map((s) => <Swatch key={s} name={s} />)}</div>
          <div className="flex flex-col gap-2">
            {STATUS.map((s) => (
              <div key={s.tone} className="flex items-center gap-3">
                <Dot tone={s.tone} />
                <span className="w-10 text-sm">{s.name}</span>
                <Badge tone={s.tone} dot>{s.name}</Badge>
                <span className="text-xs text-muted">{s.use}</span>
              </div>
            ))}
            <div className="mt-2 flex items-center gap-2">
              {SERIES_COLORS.map((c, i) => <span key={c} className="h-3 w-8 rounded-sm" style={{ background: c }} title={`c${i + 1}`} />)}
              <span className="text-xs text-muted">序列色，只用于区分线条，不表达好坏</span>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="操作">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={<Plus size={14} />}>新建客户</Button>
            <Button>导出</Button>
            <Button variant="ghost">取消</Button>
            <Button variant="danger">停用</Button>
            <Segmented label="时间范围示例" value="24h" onChange={() => undefined} options={[{ value: '1h', label: '1 小时' }, { value: '24h', label: '24 小时' }, { value: '7d', label: '7 天' }]} />
          </div>
        </Panel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Stat label="连接成功率" value="99.1%" sub="目标 99%" tone="ok"><Spark points={a} color="var(--ok)" /></Stat>
          <Stat label="受影响客户" value="5" sub="LA Mesa 故障" tone="sev" />
        </div>
      </div>

      <Panel title="表格" description="表头 32，行高 40，数字右对齐，状态放第一列" flush>
        <table className="tbl">
          <thead><tr><th>状态</th><th>节点</th><th className="r">成功率</th><th>探测</th><th>配额</th></tr></thead>
          <tbody>
            {[['ok', 'Tokyo Ginza', 0.996], ['warn', 'SG Harbour', 0.972], ['sev', 'LA Mesa', 0.61]].map(([t, n, v], i) => (
              <tr key={String(n)}>
                <td><Badge tone={t as Tone} dot>{STATUS.find((s) => s.tone === t)?.name}</Badge></td>
                <td className="font-medium">{n}</td>
                <td className="r num">{pct(Number(v))}</td>
                <td><ProbeStrip probes={Array.from({ length: 24 }, (_, k) => (t === 'sev' && k > 18 ? 'dead' : k === 7 && i === 1 ? null : 'alive'))} /></td>
                <td><Meter value={[0.42, 0.86, 0.97][i]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="时间序列" description="悬停看同一时刻所有序列；空值断线，不画成 0" source="connection_events">
          <Legend items={[{ label: '全部', color: 'var(--c1)' }, { label: 'Windows', color: 'var(--c2)', dashed: true }]} />
          <div className="mt-2">
            <LineChart
              series={[{ name: '全部', color: 'var(--c1)', points: a, area: true }, { name: 'Windows', color: 'var(--c2)', points: b, dashed: true }]}
              format={pct} domain={[0.9, 1]} guides={[{ value: 0.99, label: '目标 99%', tone: 'ok' }]} longRange={range !== '1h' && range !== '24h'}
            />
          </div>
        </Panel>
        <Panel title="柱状与热力">
          <Bars height={120} names={['直连', '家宽']} colors={['var(--c1)', 'var(--c3)']} format={(v) => `${v} GB`}
            data={['一', '二', '三', '四', '五', '六', '日'].map((d, i) => ({ label: d, values: [20 + i * 3, 8 + (i % 3) * 4] }))} />
          <div className="mt-4 overflow-x-auto">
            <Heatmap rowLabels={['周一', '周二', '周三']} rows={[0, 1, 2].map((r) => Array.from({ length: 24 }, (_, h) => (h > 8 && h < 24 ? ((h * 7 + r * 11) % 60) : 0)))} cell={12} />
          </div>
        </Panel>
      </div>

      <Panel title="状态" description="每个面板自己处理加载、出错、陈旧；一块数据慢，不拖累整页">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div><div className="mb-2 text-xs text-faint">加载中</div><Loading rows={3} /></div>
          <div><div className="mb-2 text-xs text-faint">出错</div><ErrorState source="operations_agent_samples" /></div>
          <div><div className="mb-2 text-xs text-faint">陈旧</div><div className="rounded-md border border-line px-3 py-2"><Freshness source="usage_report_sources" ageMin={42} stale /></div></div>
          <div><div className="mb-2 text-xs text-faint">空</div><div className="rounded-md border border-line"><Empty title="没有进行中的事故" hint="过去 24 小时所有节点都在线。" /></div></div>
          <div className="xl:col-span-2"><div className="mb-2 text-xs text-faint">未接入（不画空图）</div><NotWired what="每跳握手耗时" needs="等 #707 的 chain_hops 表上线" /></div>
        </div>
      </Panel>

      <FormSpec />
      <OverlaySpec />
      <AccessSpec />
    </div>
  );
}
