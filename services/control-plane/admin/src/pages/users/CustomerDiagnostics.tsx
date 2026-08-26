import type { OpsPersonView } from '../../lib/ops-views';
import { catalogLag } from '../../lib/revision';
import { timeAgo } from '../../lib/format';
import { nodeHealthLabel } from '../../lib/path-status';
import { Banner, Note, Stat, StatGrid } from '../../ui';

export function CustomerDiagnostics({
  person,
  publishedRevision,
}: {
  person: OpsPersonView;
  publishedRevision: number | null;
}) {
  if (person.telemetryState === 'unavailable') {
    return (
      <section className="drawer-section">
        <Note>客户心跳不可用：无法判断在线和路径。这不是「离线」。</Note>
      </section>
    );
  }
  if (person.telemetryState === 'loading') {
    return <section className="drawer-section"><Note tone="info">正在读取心跳…</Note></section>;
  }
  if (person.telemetryState === 'unreported') {
    return (
      <section className="drawer-section">
        <Note>未上报：这个客户还没有心跳。这不是故障。</Note>
      </section>
    );
  }
  const path = person.pathActivity;
  const latest = person.latestActivity;
  const lag = catalogLag(latest?.catalogRevision, publishedRevision);
  return (
    <section className="diagnostic-summary drawer-section" aria-label="客户诊断">
      {latest && Date.now() / 1000 - latest.lastSeenAt > 40 * 60 && (
        <Banner tone="error" message={`最新心跳已过期：${timeAgo(latest.lastSeenAt)}。路径读数来自另一台设备时以路径设备为准。`} />
      )}
      <StatGrid>
        <Stat
          label="最新心跳设备"
          value={latest?.osVersion || '未知设备'}
          note={<>
            {latest ? timeAgo(latest.lastSeenAt) : '—'}
            {latest?.clientVersion ? ` · ${latest.clientVersion}` : ''}
            {' · '}{latest?.uiState || '未上报屏幕'}
          </>}
        />
        <Stat
          label="路径所用设备"
          value={person.selectedServer || '未选择'}
          note={`${person.nodeHealthLabel || nodeHealthLabel(person.nodeHealth)}${path?.osVersion ? ` · ${path.osVersion}` : ''}`}
        />
        <Stat
          label="隧道出口 gstatic"
          value={person.exitDelayMs == null ? '未测' : `${person.exitDelayMs} ms`}
          note={person.exitDelayAtSec ? `采样 ${timeAgo(person.exitDelayAtSec)}` : '采样时间未上报'}
          tone={person.exitDelayMs == null ? 'unknown' : person.exitDelayMs >= 800 ? 'severe' : person.exitDelayMs >= 400 ? 'warn' : undefined}
        />
        <Stat
          label="TCP :443"
          value={person.tcpDelayMs == null ? '未测' : `${person.tcpDelayMs} ms`}
          note={person.tcpDelayAtSec ? `采样 ${timeAgo(person.tcpDelayAtSec)}` : '采样时间未上报'}
          tone={person.tcpDelayMs == null ? 'unknown' : person.tcpDelayMs >= 800 ? 'severe' : person.tcpDelayMs >= 400 ? 'warn' : undefined}
        />
        <Stat
          label="目录版本"
          value={lag.state === 'behind' ? `落后 ${lag.by} 版` : lag.state === 'current' ? '已是最新' : lag.state === 'unreported' ? '未上报版本' : lag.state}
          tone={lag.state === 'behind' ? 'severe' : lag.state === 'current' ? undefined : 'unknown'}
        />
      </StatGrid>
    </section>
  );
}
