import { memo, useId } from 'react';
import { formatBytes, timeAgo } from '../../lib/format';
import { nodeHealthLabel, nodeHealthTone } from '../../lib/path-status';
import { personAccountLabel, personTelemetryLabel, type OpsPersonView } from '../../lib/ops-views';
import { Status } from '../../ui';
import { usePrivacy } from '../../privacy';

function telemetryTone(person: OpsPersonView): 'ok' | 'warn' | 'unknown' {
  if (person.telemetryState !== 'reported') return 'unknown';
  // A customer simply being offline is not an incident. Yellow is reserved for
  // something that needs attention; an old heartbeat is context, not a warning.
  return person.online ? 'ok' : 'unknown';
}

/**
 * One measurement per line, each with its own sample age on the same line.
 * The previous layout ran both readings and both timestamps into one wrapping
 * paragraph, which produced an orphan "钟前" on almost every row.
 */
function PathMetric({ label, value, at, fresh }: {
  label: string;
  value: string;
  at: number | null;
  fresh: boolean;
}) {
  return (
    <div className="path-metric">
      <dt>{label}</dt>
      <dd>
        <span className="path-value mono">{value}{value !== '未测' && !fresh ? ' · 过期' : ''}</span>
        <span className="path-age">{at ? `${fresh ? '' : '过期采样 · '}${timeAgo(at)}` : '采样时间未知'}</span>
      </dd>
    </div>
  );
}

export const PersonRow = memo(function PersonRow({ person, selected, onOpen }: {
  person: OpsPersonView;
  selected?: boolean;
  onOpen: (userId: string) => void;
}) {
  const privacy = usePrivacy();
  const descId = useId();
  const path = person.pathActivity;
  return (
    <article
      className={`card person-row${selected ? ' selected' : ''}`}
      onClick={() => onOpen(person.userId)}
    >
      <div className="person-col person-id">
        <button
          type="button"
          className="person-open"
          aria-describedby={`${descId}-node ${descId}-path ${descId}-usage`}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(person.userId);
          }}
        >
          <strong>{privacy.email(person.email)}</strong>
        </button>
        <span className="person-live">
          <span className={`nc-dot nc-dot-${telemetryTone(person)}`} aria-hidden />
          {personTelemetryLabel(person)}{person.lastSeenAt ? ` · ${timeAgo(person.lastSeenAt)}` : ''}
        </span>
        <div className="person-tags">
          {person.accountState === 'present' && person.user
            ? <Status value={person.user.status} />
            : <span className="chip chip-unknown">{personAccountLabel(person)}</span>}
          {person.expired && <span className="expired-flag">已过期</span>}
          {person.expiring && !person.expired && <span className="chip chip-warn">将到期</span>}
        </div>
      </div>

      <div className="person-col person-node" id={`${descId}-node`}>
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

      <div className="person-col person-path" id={`${descId}-path`}>
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
              fresh={person.exitDelayFresh}
            />
            <PathMetric
              label="TCP :443"
              value={person.tcpDelayMs == null ? '未测' : `${person.tcpDelayMs} ms`}
              at={person.tcpDelayAtSec}
              fresh={person.tcpDelayFresh}
            />
          </dl>
        )}
      </div>

      <div className="person-col person-usage" id={`${descId}-usage`}>
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
    </article>
  );
});
