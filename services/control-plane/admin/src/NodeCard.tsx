import { CarrierPing } from './carriers';
import { formatBytes } from './lib/format';
import type { OpsNodeView } from './lib/ops-views';
import { worstCarrier } from './lib/carrier';
import { usePrivacy } from './privacy';

function pct(used: number | null | undefined, total: number | null | undefined): number | null {
  if (used == null || total == null || total <= 0) return null;
  return (used / total) * 100;
}

function Bar({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  const width = value == null ? 0 : Math.max(2, Math.min(100, value));
  const tone = value == null ? 'unknown' : value >= 90 ? 'bad' : value >= 80 ? 'warn' : 'ok';
  return (
    <div className={`nc-metric nc-${tone}`}>
      <div className="nc-metric-head">
        <span>{label}</span>
        <strong>{value == null ? '—' : `${Math.round(value)}%`}</strong>
      </div>
      <div className="nc-track" aria-hidden>
        <span style={{ width: `${width}%` }} />
      </div>
      <small>{detail}</small>
    </div>
  );
}

export function NodeCard({
  node,
  density = 'full',
  selected = false,
  onOpen,
}: {
  node: OpsNodeView;
  density?: 'full' | 'compact';
  selected?: boolean;
  onOpen: () => void;
}) {
  const privacy = usePrivacy();
  const agent = node.agent;
  const cpu = agent?.cpu ?? null;
  const mem = pct(agent?.memUsed, agent?.memTotal);
  const disk = pct(agent?.diskUsed, agent?.diskTotal);
  const trafficQuota = node.billing.trafficQuotaBytes;
  const trafficUsed = trafficQuota != null && node.trafficRemain != null
    ? trafficQuota - node.trafficRemain
    : null;
  const trafficPct = pct(trafficUsed, trafficQuota);
  const worst = worstCarrier(agent?.carriers ?? null);
  const price = node.billing.price != null
    ? `${node.billing.currency || ''}${node.billing.price}`
    : null;

  return (
    <article
      className={`node-card node-card-${density}${selected ? ' selected' : ''}`}
      data-selected={selected ? 'true' : 'false'}
      tabIndex={0}
      role="button"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="nc-top">
        <span className={`nc-dot nc-dot-${node.dot}`} />
        <div className="nc-title">
          <strong>{node.name}</strong>
          <small>
            {privacy.ip(node.quality?.publicIp || node.quality?.host || node.profile?.publicIp)}
            {node.catalogListed === false ? ' · 不在目录' : ''}
            {!node.agent ? ' · 没装探针' : ''}
          </small>
        </div>
        <div className="nc-flags">
          {node.occupancy > 0 && <span className="nc-badge">{node.occupancy} 人</span>}
          <span className="nc-status">{node.blockLabel}</span>
        </div>
      </div>

      {density === 'full' && (
        <div className="nc-bill">
          <span>{price ? privacy.money(price) : '价格未填'}</span>
          <span>{node.billing.renewsAt ? `续费 ${new Date(node.billing.renewsAt * 1000).toLocaleDateString('zh-CN')}` : '续费未填'}</span>
        </div>
      )}

      <div className={`nc-metrics${density === 'compact' ? ' nc-metrics-compact' : ''}`}>
        <Bar label="CPU" value={cpu} detail={agent?.load1 != null ? `${agent.load1.toFixed(2)} load` : '未上报'} />
        <Bar
          label="内存"
          value={mem}
          detail={agent?.memUsed != null && agent.memTotal ? `${formatBytes(agent.memUsed)} / ${formatBytes(agent.memTotal)}` : '未上报'}
        />
        {density === 'full' && (
          <>
            <Bar
              label="硬盘"
              value={disk}
              detail={agent?.diskUsed != null && agent.diskTotal ? `${formatBytes(agent.diskUsed)} / ${formatBytes(agent.diskTotal)}` : '未上报'}
            />
            <Bar
              label="流量"
              value={trafficPct}
              detail={
                trafficQuota == null
                  ? '未设额度'
                  : node.trafficRemain == null
                    ? '本期用量未建立基线'
                    : `${formatBytes(trafficUsed ?? 0)} / ${formatBytes(trafficQuota)}${node.quotaAssumed ? ' · 按合计' : ''}`
              }
            />
          </>
        )}
      </div>

      {density === 'full' && (
        <div className="nc-net">
          <span title="Komari 累计下行字节，不是当前速度">↓ 累计 {agent?.netIn == null ? '—' : formatBytes(agent.netIn)}</span>
          <span title="Komari 累计上行字节，不是当前速度">↑ 累计 {agent?.netOut == null ? '—' : formatBytes(agent.netOut)}</span>
          <span>{worst ? `${worst.label} ${worst.latencyText}` : '三网未测'}</span>
        </div>
      )}

      {density === 'full' && agent?.carriers && (
        <div className="nc-carriers">
          <CarrierPing carriers={agent.carriers} />
        </div>
      )}

      {density === 'compact' && (
        <div className="nc-net">
          <span>{worst ? `${worst.label} ${worst.latencyText}` : '三网未测'}</span>
        </div>
      )}
    </article>
  );
}
