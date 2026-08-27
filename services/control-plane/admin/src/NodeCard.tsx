import { CarrierMini } from './carriers';
import { formatBytes, formatDuration } from './lib/format';
import { carrierLossLine, type OpsNodeView } from './lib/ops-views';
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
      <small title={detail}>{detail}</small>
    </div>
  );
}

function occupancyText(node: OpsNodeView): string {
  if (node.occupancyState !== 'known') return '占用不可判断';
  return `${node.occupancy ?? 0} 人在用`;
}

function catalogText(node: OpsNodeView): string {
  if (node.catalogState === 'known-listed') return '在售';
  if (node.catalogState === 'known-unlisted') return '不在目录';
  return '目录未知';
}

function agentText(node: OpsNodeView): string {
  if (node.agentState === 'unavailable') return '探针源不可用';
  if (node.agentState === 'unreported') return '没装探针';
  if (node.agentState === 'stale') return '探针过期';
  return node.agent?.os ?? '';
}

/** Why this machine is in front of you, in one line, without repeating the pill. */
function reasonText(node: OpsNodeView): string {
  const loss = carrierLossLine(node);
  if (loss) return loss;
  const parts = [catalogText(node), occupancyText(node)];
  if (node.agentState !== 'reported') parts.push(agentText(node));
  return parts.filter(Boolean).join(' · ');
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
  const price = node.billing.price != null ? `${node.billing.currency || ''}${node.billing.price}` : null;
  const offline = node.qualityState === 'reported' && (node.blockStatus === 'DOWN' || node.blockStatus === 'EDGE_FAIL' || node.ok === false);
  const ip = node.quality?.publicIp || node.quality?.host || node.profile?.publicIp;
  // No probe means no CPU, memory, disk or carrier reading at all. Rendering
  // four empty meters spends half a card saying nothing; one stated gap says
  // the same thing and says which readings are missing.
  const noProbe = node.agentState === 'unreported' || node.agentState === 'unavailable';
  const subtitle = [ip ? privacy.ip(ip) : null, agent?.os ?? null].filter(Boolean).join(' · ');

  return (
    <article
      className={`node-card node-card-${density} nc-tone-${node.dot}${selected ? ' selected' : ''}${offline ? ' node-card-offline' : ''}`}
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
        <div className="nc-title">
          <strong title={node.name}>{node.name}</strong>
          <small title={subtitle || undefined}>{subtitle || (noProbe ? agentText(node) : '\u00a0')}</small>
        </div>
        <span className="nc-state">
          <span className={`nc-dot nc-dot-${node.dot}`} aria-hidden />
          {node.blockLabel}
        </span>
      </div>

      {density === 'compact' ? (
        <>
          <p className="nc-reason" title={reasonText(node)}>{reasonText(node)}</p>
          {noProbe ? (
            <p className="nc-facts nc-facts-gap"><b>{agentText(node)}</b><span>没有 CPU / 内存读数</span></p>
          ) : (
            <div className="nc-metrics">
              <Bar label="CPU" value={cpu} detail={agent?.load1 != null ? `load ${agent.load1.toFixed(2)}` : agentText(node)} />
              <Bar
                label="内存"
                value={mem}
                detail={agent?.memUsed != null && agent.memTotal ? `${formatBytes(agent.memUsed)} / ${formatBytes(agent.memTotal)}` : agentText(node)}
              />
            </div>
          )}
          {offline && <span className="nc-offline-flag">离线 · 仍可点开处理</span>}
          {carrierLossLine(node)
            ? <span className="nc-action-fill">回程丢包 · 点开看三网</span>
            : !node.billing.renewsAt && <span className="nc-action-fill">点开补续费日</span>}
        </>
      ) : (
        <>
          {/* Two fixed fact lines rather than one wrapping one, so cards in a
              row keep the same internal rhythm. */}
          <div className="nc-facts">
            <span><b>{catalogText(node)}</b></span>
            <span>{occupancyText(node)}</span>
            <span>{agent?.uptime != null ? `运行 ${formatDuration(agent.uptime)}` : agentText(node)}</span>
          </div>
          <div className="nc-facts nc-facts-bill">
            <span>{price ? privacy.money(price) : '价格未填'}</span>
            <span>{node.billing.renewsAt ? `续费 ${new Date(node.billing.renewsAt * 1000).toLocaleDateString('zh-CN')}` : '续费未填 · 点开补日期'}</span>
            <span>累计 ↓ {agent?.netIn == null ? '—' : formatBytes(agent.netIn)} ↑ {agent?.netOut == null ? '—' : formatBytes(agent.netOut)}</span>
          </div>

          {noProbe ? (
            <div className="nc-noprobe">
              <strong>{agentText(node)}</strong>
              <span>CPU / 内存 / 硬盘 / 三网 均无读数</span>
              <span>{trafficQuota == null ? '本期流量未设额度' : node.trafficRemain == null ? '本期用量未建立基线' : `本期已用 ${formatBytes(trafficUsed ?? 0)} / ${formatBytes(trafficQuota)}`}</span>
            </div>
          ) : (
            <>
              <div className="nc-metrics">
                <Bar label="CPU" value={cpu} detail={agent?.load1 != null ? `load ${agent.load1.toFixed(2)}` : agentText(node)} />
                <Bar
                  label="内存"
                  value={mem}
                  detail={agent?.memUsed != null && agent.memTotal ? `${formatBytes(agent.memUsed)} / ${formatBytes(agent.memTotal)}` : agentText(node)}
                />
                <Bar
                  label="硬盘"
                  value={disk}
                  detail={agent?.diskUsed != null && agent.diskTotal ? `${formatBytes(agent.diskUsed)} / ${formatBytes(agent.diskTotal)}` : agentText(node)}
                />
                <Bar
                  label="本期流量"
                  value={trafficPct}
                  detail={
                    trafficQuota == null
                      ? '未设额度'
                      : node.trafficRemain == null
                        ? '本期用量未建立基线'
                        : `${formatBytes(trafficUsed ?? 0)} / ${formatBytes(trafficQuota)}`
                  }
                />
              </div>

              <CarrierMini carriers={agent?.carriers ?? null} />
            </>
          )}

          {node.routeKeywords.length > 0 && (
            <div className="chip-list">
              {node.routeKeywords.slice(0, 4).map((keyword) => (
                <span className={`chip${/9929|CMIN2|CN2|GIA/.test(keyword) ? ' chip-hot' : ''}`} key={keyword}>{keyword}</span>
              ))}
            </div>
          )}

          <div className="nc-foot">
            {node.pathSummary && (node.pathSummary.worstExitMs != null || node.pathSummary.worstTcpMs != null) ? (
              <span>
                客户路径最差
                {node.pathSummary.worstExitMs != null ? ` 出口 ${node.pathSummary.worstExitMs}ms` : ''}
                {node.pathSummary.worstTcpMs != null ? ` TCP ${node.pathSummary.worstTcpMs}ms` : ''}
              </span>
            ) : node.occupancyState !== 'known' ? (
              <span>客户路径不可判断</span>
            ) : (
              <span>没有在线客户路径</span>
            )}
            {node.catalogState === 'known-listed' && node.dot === 'bad' && node.occupancyState === 'known' && (
              <span className="nc-action">需下架 · 受影响 {node.occupancy ?? 0} 人</span>
            )}
            {offline && <span className="nc-offline-flag">离线 · 仍可点开处理</span>}
            {!node.billing.renewsAt && <span className="nc-action-fill">点开补续费日</span>}
          </div>
        </>
      )}
    </article>
  );
}
