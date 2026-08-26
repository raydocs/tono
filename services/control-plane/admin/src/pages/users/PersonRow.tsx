import { formatBytes, timeAgo } from '../../lib/format';
import { nodeHealthLabel, nodeHealthTone } from '../../lib/path-status';
import type { OpsPersonView } from '../../lib/ops-views';
import { Status } from '../../ui';
import { usePrivacy } from '../../privacy';

function telemetryLabel(person: OpsPersonView): string {
  if (person.telemetryState === 'loading') return '心跳加载中';
  if (person.telemetryState === 'unavailable') return '心跳不可用';
  if (person.telemetryState === 'unreported') return '未上报';
  if (person.online) return `${person.onlineDeviceCount} 台在线`;
  return '离线';
}

export function PersonRow({ person, selected, onOpen }: {
  person: OpsPersonView;
  selected?: boolean;
  onOpen: () => void;
}) {
  const privacy = usePrivacy();
  const path = person.pathActivity;
  return (
    <button type="button" className={`card person-row${selected ? ' selected' : ''}`} onClick={onOpen}>
      <div className="person-id">
        <strong>{privacy.email(person.email)}</strong>
        <div className="person-tags">
          {person.user ? <Status value={person.user.status} /> : <span className="chip chip-muted">心跳身份未进入客户库</span>}
          {person.expired && <span className="expired-flag">已过期</span>}
          {person.expiring && !person.expired && <span className="chip chip-warn">将到期</span>}
          {person.chores.map((chore) => <span className="chip chip-muted" key={chore}>{chore}</span>)}
        </div>
        <small className="muted">{telemetryLabel(person)}{person.lastSeenAt ? ` · ${timeAgo(person.lastSeenAt)}` : ''}</small>
      </div>
      <div className="person-path">
        {person.telemetryState !== 'reported' ? (
          <span className="muted">
            {person.telemetryState === 'unavailable' ? '无法判断路径' : person.telemetryState === 'unreported' ? '还没有路径读数' : '…'}
          </span>
        ) : (
          <>
            <strong>{person.selectedServer ?? '未选节点'}</strong>
            {person.selectedServer && (
              <span className={`chip chip-${nodeHealthTone(person.nodeHealth)}`}>
                {person.nodeHealthLabel || nodeHealthLabel(person.nodeHealth)}
              </span>
            )}
            <small className="mono">隧道出口 gstatic {person.exitDelayMs == null ? '未测' : `${person.exitDelayMs}ms`}</small>
            <small className="mono">TCP :443 {person.tcpDelayMs == null ? '未测' : `${person.tcpDelayMs}ms`}</small>
            <small className="muted">
              {person.exitDelayAtSec ? `出口采样 ${timeAgo(person.exitDelayAtSec)}` : '出口采样时间未知'}
              {' · '}
              {person.tcpDelayAtSec ? `TCP 采样 ${timeAgo(person.tcpDelayAtSec)}` : 'TCP 采样时间未知'}
            </small>
          </>
        )}
      </div>
      <div className="person-usage">
        {person.user ? (
          <>
            <span className="mono">
              {formatBytes(person.usageBytes)}
              {person.quotaBytes == null ? ' / 不限' : ` / ${formatBytes(person.quotaBytes)}`}
            </span>
            {person.quotaRatio != null && (
              <div className="nc-track" aria-hidden>
                <span style={{ width: `${Math.max(2, Math.min(100, person.quotaRatio * 100))}%` }} />
              </div>
            )}
            {person.catalogLag.state === 'behind' && <small className="chip chip-risk">目录落后 {person.catalogLag.by}</small>}
          </>
        ) : <span className="muted">无账户资料</span>}
      </div>
      <div className="muted">{path?.osVersion}</div>
    </button>
  );
}
