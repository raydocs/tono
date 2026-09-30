import { Upload } from 'lucide-react';
import { LineChart } from '@proto/charts/LineChart';
import { Badge, Button, Legend, PageHeader, Panel, Stat } from '@proto/ds';
import { ago, pct } from '@proto/format';
import { RELEASES } from '@proto/mock/business';
import { series } from '@proto/mock/series';
import { useProto } from '@proto/state';

const VERSION_COLOR: Record<string, string> = { '1.5.1': 'var(--c5)', '1.5.0': 'var(--c1)', '1.4.2': 'var(--c2)', '1.3.9': 'var(--c6)' };
const SUCCESS_BY_VERSION = [
  { v: 'macOS 1.5.0', ok: 0.993 }, { v: 'macOS 1.4.2', ok: 0.986 }, { v: 'macOS 1.3.9', ok: 0.962 },
  { v: 'Windows 1.5.0', ok: 0.988 }, { v: 'Windows 1.4.2', ok: 0.921 },
];

export default function Clients() {
  const { range } = useProto();
  const long = range === '7d' || range === '30d';
  const adoption = (platform: string) => RELEASES.filter((r) => r.platform === platform && r.channel === '正式').map((r) => ({
    name: r.version, color: VERSION_COLOR[r.version],
    points: series(`adopt:${platform}:${r.version}`, range, { base: r.adoption, noise: 0.04, min: 0, max: 1 }),
  }));

  return (
    <div>
      <PageHeader title="客户端" description="各平台在跑什么版本、哪个版本出问题、下一版发给谁。"
        actions={<Button variant="primary" icon={<Upload size={14} />}>登记新版本</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="macOS 最新版覆盖" value="71%" sub="1.5.0 · 31 台设备中 22 台" />
        <Stat label="Windows 最新版覆盖" value="52%" sub="1.5.0 · 20 台设备中 12 台" tone="warn" />
        <Stat label="低于最低支持版本" value="3" tone="sev" sub="macOS 1.3.9，提示升级" />
        <Stat label="内测中" value="1" sub="Windows 1.5.1 · 待校验" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        {(['macOS', 'Windows'] as const).map((p) => (
          <Panel key={p} title={`${p} 版本分布`} description="每个版本占在线设备的比例" source="ops_device_status">
            <LineChart height={160} longRange={long} domain={[0, 1]} format={(v) => pct(v, 0)} series={adoption(p)} />
            <div className="mt-2"><Legend items={adoption(p).map((s) => ({ label: s.name, color: s.color }))} /></div>
          </Panel>
        ))}
        <Panel title="每个版本的连接成功率" description="过去 24 小时；低于 95% 的版本该催升级" source="connection_events">
          <ul className="flex flex-col gap-2.5">
            {SUCCESS_BY_VERSION.map((s) => (
              <li key={s.v} className="grid grid-cols-[110px_1fr_52px] items-center gap-3 text-sm">
                <span className="text-muted">{s.v}</span>
                <span className="h-2 overflow-hidden rounded-full bg-hover"><span className="block h-full rounded-full" style={{ width: `${((s.ok - 0.85) / 0.15) * 100}%`, background: s.ok < 0.95 ? 'var(--sev)' : s.ok < 0.99 ? 'var(--warn)' : 'var(--ok)' }} /></span>
                <span className={`text-right num ${s.ok < 0.95 ? 'text-sev' : ''}`}>{pct(s.ok)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-faint">条从 85% 起画，差距才看得见。</p>
        </Panel>
      </div>

      <Panel className="mt-4" title="发布记录" description="发布前校验 R2 里的文件大小和 sha256；没接自动更新的平台不能点发布" source="client_releases" flush>
        <table className="tbl">
          <thead><tr><th>平台</th><th>版本</th><th>通道</th><th className="r">设备</th><th className="r">覆盖</th><th>签名</th><th>校验</th><th className="r">发布于</th><th /></tr></thead>
          <tbody>{RELEASES.map((r) => (
            <tr key={`${r.platform}${r.version}`}>
              <td>{r.platform}</td>
              <td className="num">{r.version} <span className="text-faint">({r.build})</span>{r.floor && <span className="ml-2"><Badge tone="warn">最低支持</Badge></span>}</td>
              <td>{r.channel === '内测' ? <Badge tone="info">内测</Badge> : <span className="text-muted">正式</span>}</td>
              <td className="r num">{r.users}</td>
              <td className="r num">{pct(r.adoption, 0)}</td>
              <td>{r.signed ? <Badge tone="ok">已签名</Badge> : <Badge tone="sev">未签名</Badge>}</td>
              <td>{r.verified ? <Badge tone="ok">sha256 一致</Badge> : <Badge tone="warn">待校验</Badge>}</td>
              <td className="r text-muted">{ago(r.publishedAt)}</td>
              <td className="r space-x-1">{r.channel === '内测' ? <Button size="xs">校验并发布</Button> : <Button size="xs" variant="ghost">撤回</Button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </Panel>
    </div>
  );
}
