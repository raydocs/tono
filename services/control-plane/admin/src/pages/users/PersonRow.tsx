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

function telemetryTone(person: OpsPersonView): 'ok' | 'warn' | 'unknown' {
  if (person.telemetryState !== 'reported') return 'unknown';
  return person.online ? 'ok' : 'warn';
}

function accountChip(person: OpsPersonView) {
  if (person.accountState === 'present' && person.user) return null;
  if (person.accountState === 'loading') return '客户资料加载中';
  if (person.accountState === 'unavailable') return '客户资料不可用';
  return '心跳身份未进入客户库';
}

/**
 * One measurement per line, each with its own sample age on the same line.
 * The previous layout ran both readings and both timestamps into one wrapping
 * paragraph, which produced an orphan "钟前" on almost every row.
 */
function PathMetric({ label, value, at }: { label: string; value: string; at: number | null }) {
  return (
    <div className="path-metric">
      <dt>{label}</dt>
      <dd>
        <span className="path-value mono">{value}</span>
        <span className="path-age">{at ? timeAgo(at) : '采样时间未知'}</span>
      </dd>
    </div>
  );
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
      <div className="person-col person-id">
        <strong>{privacy.email(person.email)}</strong>
        <span className="person-live">
          <span className={`nc-dot nc-dot-${telemetryTone(person)}`} aria-hidden />
          {telemetryLabel(person)}{person.lastSeenAt ? ` · ${timeAgo(person.lastSeenAt)}` : ''}
        </span>
        <div className="person-tags">
          {person.accountState === 'present' && person.user
            ? <Status value={person.user.status} />
            : <span className="chip chip-unknown">{accountChip(person)}</span>}
          {person.expired && <span className="expired-flag">已过期</span>}
          {person.expiring && !person.expired && <span className="chip chip-warn">将到期</span>}
        </div>
      </div>

      <div className="person-col person-node">
        <span className="col-label">节点</span>
        {person.telemetryState !== 'reported' ? (
          <span className="muted">
            {person.telemetryState === 'unavailable' ? '无法判断节点' : person.telemetryState === 'unreported' ? '未上报节点' : '…'}
          </span>
        ) : (
          <span className="person-node-value">
            <strong>{person.selectedServer ?? '未选节点'}</strong>
            {person.selectedServer && (
              <span className={`chip chip-wrap chip-${nodeHealthTone(person.nodeHealth)}`}>
                {person.nodeHealthLabel || nodeHealthLabel(person.nodeHealth)}
              </span>
            )}
          </span>
        )}
      </div>

      <div className="person-col person-path">
        <span className="col-label">客户路径</span>
        {person.telemetryState !== 'reported' ? (
          <span className="muted">
            {person.telemetryState === 'unavailable' ? '无法判断路径' : person.telemetryState === 'unreported' ? '还没有路径读数' : '…'}
          </span>
        ) : (
          <dl className="path-metrics">
            <PathMetric
              label="出口 gstatic"
              value={person.exitDelayMs == null ? '未测' : `${person.exitDelayMs} ms`}
              at={person.exitDelayAtSec}
            />
            <PathMetric
              label="TCP :443"
              value={person.tcpDelayMs == null ? '未测' : `${person.tcpDelayMs} ms`}
              at={person.tcpDelayAtSec}
            />
          </dl>
        )}
      </div>

      <div className="person-col person-usage">
        <span className="col-label">额度 / 待办</span>
        {person.accountState === 'present' && person.user ? (
          <>
            <span className="usage-line">
              {formatBytes(person.usageBytes)}
              {person.quotaBytes == null ? ' / 不限' : ` / ${formatBytes(person.quotaBytes)}`}
            </span>
            {person.quotaRatio != null && (
              <div className={`nc-track${person.quotaRatio >= 1 ? ' nc-bad' : person.quotaRatio >= 0.8 ? ' nc-warn' : ''}`} aria-hidden>
                <span style={{ width: `${Math.max(2, Math.min(100, person.quotaRatio * 100))}%` }} />
              </div>
            )}
            <div className="person-tags">
              {person.catalogLag.state === 'behind' && <span className="chip chip-bad">目录落后 {person.catalogLag.by}</span>}
              {person.chores.map((chore) => <span className="chip chip-unknown" key={chore}>{chore}</span>)}
            </div>
          </>
        ) : (
          <span className="muted">
            {person.accountState === 'loading' ? '客户资料加载中' : person.accountState === 'unavailable' ? '客户资料不可用' : '无账户资料'}
          </span>
        )}
        {path?.osVersion ? <span className="person-device">{path.osVersion}</span> : null}
      </div>
    </button>
  );
}
