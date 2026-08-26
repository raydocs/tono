import type { OpsPersonView } from '../../lib/ops-views';
import { catalogLag } from '../../lib/revision';
import { formatBytes, timeAgo, timestamp } from '../../lib/format';
import { nodeHealthLabel } from '../../lib/path-status';
import { Banner } from '../../ui';

export function CustomerDiagnostics({
  person,
  publishedRevision,
}: {
  person: OpsPersonView;
  publishedRevision: number | null;
}) {
  if (person.telemetryState === 'unavailable') {
    return <div className="diagnostic-empty"><strong>客户心跳不可用</strong><span>无法判断在线和路径，不是离线。</span></div>;
  }
  if (person.telemetryState === 'loading') {
    return <div className="muted">正在读取心跳…</div>;
  }
  if (person.telemetryState === 'unreported') {
    return <div className="diagnostic-empty"><strong>未上报</strong><span>这个客户还没有心跳，不是故障。</span></div>;
  }
  const path = person.pathActivity;
  const latest = person.latestActivity;
  const lag = catalogLag(latest?.catalogRevision, publishedRevision);
  return (
    <section className="diagnostic-summary drawer-section" aria-label="客户诊断">
      {latest && Date.now() / 1000 - latest.lastSeenAt > 40 * 60 && (
        <Banner tone="error" message={`最新心跳已过期：${timeAgo(latest.lastSeenAt)}。路径读数来自另一台设备时以路径设备为准。`} />
      )}
      <div className="diagnostic-grid">
        <div className="diagnostic-card">
          <span>最新心跳设备</span>
          <strong>{latest?.osVersion || '未知设备'}</strong>
          <small>{latest ? timeAgo(latest.lastSeenAt) : '—'} · {latest?.uiState || '未上报屏幕'}</small>
        </div>
        <div className="diagnostic-card">
          <span>路径所用设备</span>
          <strong>{person.selectedServer || '未选择'}</strong>
          <small>{person.nodeHealthLabel || nodeHealthLabel(person.nodeHealth)} · {path?.osVersion}</small>
        </div>
        <div className="diagnostic-card">
          <span>隧道出口 gstatic</span>
          <strong>{person.exitDelayMs == null ? '未测' : `${person.exitDelayMs}ms`}</strong>
          <small>{person.exitDelayAtSec ? timestamp(person.exitDelayAtSec) : '采样时间未上报'}</small>
        </div>
        <div className="diagnostic-card">
          <span>TCP :443</span>
          <strong>{person.tcpDelayMs == null ? '未测' : `${person.tcpDelayMs}ms`}</strong>
          <small>{person.tcpDelayAtSec ? timestamp(person.tcpDelayAtSec) : '采样时间未上报'}</small>
        </div>
        <div className="diagnostic-card">
          <span>目录</span>
          <strong>
            {lag.state === 'behind' ? `落后 ${lag.by}` : lag.state === 'current' ? '已是最新' : lag.state === 'unreported' ? '未上报版本' : lag.state}
          </strong>
          <small>用量 {formatBytes(person.usageBytes)}{person.quotaBytes == null ? ' / 不限' : ` / ${formatBytes(person.quotaBytes)}`}</small>
        </div>
      </div>
    </section>
  );
}
