import { useRef, useState } from 'react';
import {
  operationsApi,
  type FleetRetirePreviewDto,
  type MetricsDto,
} from '../../api';
import { CarrierPing } from '../../carriers';
import { Sparkline } from '../../charts';
import { gibibytes, unixDate } from '../../lib/fields';
import { formatBytes, formatDuration, timestamp } from '../../lib/format';
import { createExclusiveGate } from '../../lib/exclusive';
import type { OpsNodeView } from '../../lib/ops-views';
import { seriesRates } from '../../lib/traffic';
import { usePrivacy } from '../../privacy';
import { Banner, Drawer } from '../../ui';

const RISK_SIGNAL_LABELS: Record<string, string> = {
  attacker: '攻击者', abuser: '滥用者', threat: '威胁',
  malicious: '恶意', spam: '垃圾邮件', spamhaus: 'SPAMHAUS 名单',
};

function occupancyLine(node: OpsNodeView): string {
  if (node.occupancyState !== 'known') return '占用不可判断';
  if (!node.occupancy) return '现在没人连这台';
  return `${node.occupancy} 人在用`;
}

function catalogLine(node: OpsNodeView): string {
  if (node.catalogState === 'known-listed') return '在售';
  if (node.catalogState === 'known-unlisted') return '不在目录';
  return '目录未知';
}

function agentLine(node: OpsNodeView): string {
  if (node.agentState === 'unavailable') return '探针源不可用';
  if (node.agentState === 'unreported') return '没装探针';
  if (node.agentState === 'stale') return '探针过期';
  return '探针正常';
}

function NodeTrends({ metrics, name }: { metrics: MetricsDto | null; name: string }) {
  if (!metrics) return <p className="muted">还没有 24h 趋势</p>;
  const points = metrics.series[name];
  if (!points || points.length < 2) return <p className="muted">这台没有足够的趋势点</p>;
  const mem = points.map((point) => (
    point.memUsed != null && point.memTotal
      ? (point.memUsed / point.memTotal) * 100
      : null
  ));
  const rates = seriesRates(points, metrics.resolutionSeconds);
  const lastRate = [...rates].reverse().find((row) => row.inBps != null || row.outBps != null);
  return (
    <div className="node-trends">
      <div><span>CPU</span><Sparkline values={points.map((point) => point.cpu)} label={`${name} CPU`} /></div>
      <div><span>内存</span><Sparkline values={mem} label={`${name} 内存`} /></div>
      <div><span>负载</span><Sparkline values={points.map((point) => point.load1)} label={`${name} 负载`} /></div>
      {lastRate && (
        <p className="muted">
          最近采样 {timestamp(lastRate.t)}
          {lastRate.inBps != null ? ` · 下行 ${formatBytes(lastRate.inBps)}/s` : ''}
          {lastRate.outBps != null ? ` · 上行 ${formatBytes(lastRate.outBps)}/s` : ''}
        </p>
      )}
    </div>
  );
}

function BillingForm({ node, onSaved }: { node: OpsNodeView; onSaved: () => void }) {
  const profile = node.profile;
  const agent = node.agent;
  const [url, setUrl] = useState(profile?.billingUrl ?? '');
  const [quota, setQuota] = useState(profile?.trafficQuotaBytes != null ? String(Math.round(profile.trafficQuotaBytes / (1024 ** 3))) : '');
  const [used, setUsed] = useState(profile?.trafficUsedBytes != null ? String(Math.round(profile.trafficUsedBytes / (1024 ** 3))) : '');
  const [renew, setRenew] = useState(profile?.renewsAt ? new Date(profile.renewsAt * 1000).toISOString().slice(0, 10) : '');
  const [price, setPrice] = useState(profile?.price != null ? String(profile.price) : '');
  const [currency, setCurrency] = useState(profile?.currency ?? '');
  const [billingCycle, setBillingCycle] = useState(profile?.billingCycle != null ? String(profile.billingCycle) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trafficQuotaBytes = gibibytes(quota);
    const trafficUsedBytes = gibibytes(used);
    const renewsAt = unixDate(renew);
    const parsedPrice = price.trim() === '' ? null : Number(price);
    const parsedCycle = billingCycle.trim() === '' ? null : Number(billingCycle);
    const bad = [
      trafficQuotaBytes === 'invalid' ? '套餐 GB' : null,
      trafficUsedBytes === 'invalid' ? '已用 GB' : null,
      renewsAt === 'invalid' ? '续费日期' : null,
      parsedPrice !== null && !(Number.isFinite(parsedPrice) && parsedPrice >= 0) ? '价格' : null,
      parsedCycle !== null && !(Number.isSafeInteger(parsedCycle) && parsedCycle > 0) ? '账期天数' : null,
    ].filter((label): label is string => label !== null);
    if (trafficQuotaBytes === 'invalid' || trafficUsedBytes === 'invalid' || renewsAt === 'invalid' || bad.length > 0) {
      setError(`${bad.join('、')}格式不对，这次什么都没保存。`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const payload = {
        catalogName: node.name,
        billingUrl: url.trim() || null,
        price: parsedPrice,
        currency: currency.trim() || null,
        billingCycle: parsedCycle,
        trafficQuotaBytes,
        trafficUsedBytes,
        renewsAt,
        publicIp: node.quality?.publicIp ?? node.profile?.publicIp ?? undefined,
      };
      if (profile) await operationsApi.updateNodeProfile(profile.id, payload);
      else {
        await operationsApi.createNodeProfile({
          ...payload,
          cycleNetIn: agent?.netIn ?? null,
          cycleNetOut: agent?.netOut ?? null,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function startNewCycle() {
    if (!profile) return;
    setError(null);
    setBusy(true);
    try {
      await operationsApi.updateNodeProfile(profile.id, {
        cycleNetIn: agent?.netIn ?? null,
        cycleNetOut: agent?.netOut ?? null,
        trafficUsedBytes: null,
      });
      setUsed('');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '这期没清掉');
    } finally {
      setBusy(false);
    }
  }

  const billing = node.billing;
  return (
    <div className="stack">
      {billing.source !== 'none' && (
        <p className="muted">
          {billing.price != null ? `${billing.currency || ''}${billing.price}` : '没有价格'}
          {billing.billingCycle ? ` · ${billing.billingCycle} 天一期` : ''}
          {billing.source === 'komari' ? ' · 来自 Komari' : billing.source === 'mixed' ? ' · 自己填的优先，缺的用 Komari 补' : ' · 自己填的'}
        </p>
      )}
      <input className="input compact" placeholder="https://账单页" value={url} onChange={(event) => setUrl(event.target.value)} />
      <input className="input compact" placeholder="价格" value={price} onChange={(event) => setPrice(event.target.value)} />
      <input className="input compact" placeholder="货币，如 USD" value={currency} onChange={(event) => setCurrency(event.target.value)} />
      <input className="input compact" type="number" min={1} placeholder="账期天数" value={billingCycle} onChange={(event) => setBillingCycle(event.target.value)} />
      <input className="input compact" type="number" min={0} placeholder="套餐 GB" value={quota} onChange={(event) => setQuota(event.target.value)} />
      <input className="input compact" type="number" min={0} placeholder="已用 GB（手填）" value={used} onChange={(event) => setUsed(event.target.value)} />
      <input className="input compact" type="date" value={renew} onChange={(event) => setRenew(event.target.value)} />
      <small className="muted">某项要清空：把格子清空再保存。填错不会被当成清空。普通保存不会移动本期基线。</small>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void save()}>保存</button>
      {profile && (
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={busy || !agent}
          title={agent ? undefined : '这台没装探针，看不到当前用量'}
          onClick={() => void startNewCycle()}
        >新账期（移动基线）</button>
      )}
      {profile?.billingUrl && (
        <a className="btn btn-outline btn-sm" href={profile.billingUrl} target="_blank" rel="noreferrer">打开账单</a>
      )}
      <Banner message={error} tone="error" />
    </div>
  );
}

function RetireZone({
  node,
  onDone,
}: {
  node: OpsNodeView;
  onDone: () => void;
}) {
  const privacy = usePrivacy();
  const gate = useRef(createExclusiveGate());
  const [preview, setPreview] = useState<FleetRetirePreviewDto | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  async function loadPreview() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const next = await operationsApi.fleetRetirePreview(node.name);
      setPreview(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法生成下架预览');
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }

  async function retire() {
    if (!preview || confirmation !== preview.node.name || !reason.trim() || gate.current.busy) return;
    setBusy(true);
    setError(null);
    try {
      const ran = await gate.current.run(async () => {
        const result = await operationsApi.retireFleetNode(
          preview.node.name,
          preview.expectedRevision,
          confirmation,
          reason.trim(),
        );
        setMessage(`${result.node.name} 已从目录下架：r${result.previousRevision} → r${result.revision}`);
        setPreview(null);
        onDone();
      });
      if (!ran) return;
    } catch (err) {
      const text = err instanceof Error ? err.message : '下架失败';
      if (/\(409\)|revision|冲突/.test(text)) {
        setError(`${text}。目录已经变了，请重新预览。原因和确认名还留着。`);
        setPreview(null);
      } else {
        setError(text);
      }
    } finally {
      setBusy(false);
    }
  }

  if (node.catalogState !== 'known-listed') {
    return <p className="muted">不在客户目录里，没有下架动作。</p>;
  }

  return (
    <div className="stack">
      <Banner message={error} tone="error" />
      <Banner message={message} tone="ok" />
      <button className="btn btn-destructive btn-sm" type="button" disabled={loading || busy} onClick={() => void loadPreview()}>
        {loading ? '生成预览…' : preview ? '重新预览' : '预览下架'}
      </button>
      {preview && (
        <>
          <p className="muted">冻结目录 r{preview.expectedRevision}。确认时会再核对这个版本。</p>
          <div className="retire-summary">
            <div><strong>{preview.affectedUsers.length}</strong><span> 位受影响客户</span></div>
            <div><strong>{preview.changes.proxyGroupReferencesRemoved.length}</strong><span> 个代理组引用将移除</span></div>
            <div><strong>{preview.changes.profileMarkedRetired ? '会' : '不会'}</strong><span> 标记账单档案退役</span></div>
          </div>
          {preview.affectedUsers.length > 0 && (
            <ul className="detail-list affected-users">
              {preview.affectedUsers.map((user) => (
                <li key={`${user.userId}-${user.deviceId}`}>
                  <strong>{privacy.email(user.email)}</strong>
                  <span className="muted">{user.online ? '在线' : '离线'}</span>
                </li>
              ))}
            </ul>
          )}
          {preview.warnings.map((warning) => <div className="banner banner-info" key={warning}>{warning}</div>)}
          {!preview.canRetire && <Banner tone="error" message="后端判定当前不能安全下架；请处理上面的阻断项后重新预览。" />}
          <label className="retire-field">
            <span>下架原因（会写入操作记录）</span>
            <textarea className="input" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：整机失联，已确认从客户目录停售" />
          </label>
          <label className="retire-field">
            <span>输入节点全名 <code>{preview.node.name}</code> 确认</span>
            <input className="input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
          </label>
          <button
            className="btn btn-destructive"
            type="button"
            disabled={busy || !preview.canRetire || confirmation !== preview.node.name || !reason.trim()}
            onClick={() => void retire()}
          >
            {busy ? '正在下架…' : '确认从目录下架'}
          </button>
        </>
      )}
    </div>
  );
}

export function NodeDrawer({
  node,
  open,
  metrics,
  onClose,
  onChanged,
}: {
  node: OpsNodeView | null;
  open: boolean;
  metrics: MetricsDto | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const privacy = usePrivacy();
  if (!open) return null;
  if (!node) {
    return (
      <Drawer open title="找不到这个节点" onClose={onClose}>
        <p className="muted">链接里的机器已经不在当前目录、探针或占用列表里。</p>
      </Drawer>
    );
  }

  const agent = node.agent;
  const quality = node.quality;
  const ip = quality?.publicIp || quality?.host || node.profile?.publicIp;

  return (
    <Drawer open title={node.name} subtitle={`${node.blockLabel} · ${catalogLine(node)} · ${occupancyLine(node)}`} onClose={onClose}>
      <section className="drawer-section">
        <h3>状态摘要</h3>
        <p>{node.blockLabel}</p>
        <p className="muted">{catalogLine(node)} · {agentLine(node)} · {occupancyLine(node)}</p>
        <p className="muted">{privacy.ip(ip)}{agent?.os ? ` · ${agent.os}` : ''}</p>
        {node.signals.length > 0 && (
          <div className="chip-list">
            {node.signals.map((signal) => (
              <span className={`chip${signal.severity >= 3 ? ' chip-risk' : ' chip-muted'}`} key={signal.label}>{signal.label}</span>
            ))}
          </div>
        )}
        {node.pathSummary && (node.pathSummary.worstExitMs != null || node.pathSummary.worstTcpMs != null) && (
          <p>
            客户路径最差
            {node.pathSummary.worstExitMs != null ? ` 出口 ${node.pathSummary.worstExitMs}ms` : ''}
            {node.pathSummary.worstTcpMs != null ? ` TCP ${node.pathSummary.worstTcpMs}ms` : ''}
          </p>
        )}
      </section>

      <section className="drawer-section">
        <h3>资源与运行时间</h3>
        {node.agentState === 'unavailable' ? (
          <p className="muted">探针源不可用，不能判断 CPU / 内存 / 流量。</p>
        ) : node.agentState === 'unreported' ? (
          <p className="muted">没装探针。</p>
        ) : agent ? (
          <>
            <p>
              CPU {agent.cpu == null ? '—' : `${Math.round(agent.cpu)}%`}
              {agent.memUsed != null && agent.memTotal != null ? ` · 内存 ${formatBytes(agent.memUsed)} / ${formatBytes(agent.memTotal)}` : ''}
              {agent.diskUsed != null && agent.diskTotal != null ? ` · 硬盘 ${formatBytes(agent.diskUsed)} / ${formatBytes(agent.diskTotal)}` : ''}
            </p>
            <p className="muted">
              load {agent.load1 == null ? '—' : agent.load1.toFixed(2)}
              {agent.uptime != null ? ` · 运行 ${formatDuration(agent.uptime)}` : ''}
            </p>
            <p className="muted">↓ 累计 {agent.netIn == null ? '—' : formatBytes(agent.netIn)} · ↑ 累计 {agent.netOut == null ? '—' : formatBytes(agent.netOut)}</p>
          </>
        ) : null}
      </section>

      <section className="drawer-section">
        <h3>三网与大陆可达</h3>
        {node.qualityState === 'unavailable' ? (
          <p className="muted">质量源不可用，不能把空着当成没被墙。</p>
        ) : node.qualityState === 'unmeasured' ? (
          <p className="muted">大陆没测。不是好，只是没测。</p>
        ) : quality?.block?.rule ? (
          <p className="muted">{quality.block.rule}</p>
        ) : null}
        {node.agentState === 'unavailable' ? (
          <p className="muted">三网源不可用。</p>
        ) : (
          <CarrierPing carriers={agent?.carriers ?? null} />
        )}
      </section>

      <section className="drawer-section">
        <h3>24h 趋势</h3>
        <NodeTrends metrics={metrics} name={node.name} />
      </section>

      <section className="drawer-section">
        <h3>谁在使用</h3>
        {node.occupancyState !== 'known' ? (
          <p className="muted">占用不可判断，心跳源没回来。</p>
        ) : node.occupants.length === 0 ? (
          <p className="muted">现在没人连这台</p>
        ) : (
          <ul className="detail-list">
            {node.occupants.map((user) => (
              <li key={user.userId}><strong>{privacy.email(user.email)}</strong></li>
            ))}
          </ul>
        )}
      </section>

      <section className="drawer-section">
        <h3>端口与风险</h3>
        {node.qualityState === 'unavailable' ? (
          <p className="muted">质量源不可用，没有端口扫描结果。</p>
        ) : !quality?.exposure ? (
          <p className="muted">还没扫过端口。空着不代表安全。</p>
        ) : (
          <>
            {quality.exposure.unexpected.length === 0 ? (
              <p>对外只开了 SSH（:{quality.exposure.sshPorts.join('、:') || '—'}）和服务端口。</p>
            ) : (
              <p>
                多开了 {quality.exposure.unexpected.length} 个端口：
                {quality.exposure.unexpected.map((listener) => (
                  <span className="chip chip-risk" key={`exp-${listener.port}`}>
                    :{listener.port}{listener.process ? ` ${listener.process}` : ''}
                  </span>
                ))}
              </p>
            )}
            {quality.exposure.acknowledged.map((listener) => (
              <p className="muted" key={`ack-${listener.port}`}>
                已允许 :{listener.port}
                {listener.process ? ` ${listener.process}` : ''}
                {listener.reason ? ` —— ${listener.reason}` : ''}
              </p>
            ))}
          </>
        )}
        {quality && quality.riskSignals.length > 0 && (
          <>
            <p className="muted">查过 17 家名单，少数说有问题先不算。</p>
            {quality.riskSignals.map((signal) => (
              <p key={`sig-${signal.tag}`}>
                {RISK_SIGNAL_LABELS[signal.tag] ?? signal.tag}：
                {signal.no === 0
                  ? `${signal.yes} 家标了这个`
                  : `${signal.yes} 家说是，${signal.no} 家说不是`}
                {quality.riskKeywords.includes(signal.tag) ? '（算）' : '（证据不够，先不算）'}
              </p>
            ))}
          </>
        )}
        {!privacy.privacy && (quality?.backtrace || quality?.securityCheck) ? (
          <details>
            <summary>线路 / 黑名单原文</summary>
            <pre>{quality.backtrace || '无'}</pre>
            <pre>{quality.securityCheck || '无'}</pre>
          </details>
        ) : privacy.privacy ? (
          <p className="muted">隐私模式已隐藏原始 backtrace / securityCheck。</p>
        ) : null}
      </section>

      <section className="drawer-section">
        <h3>账单档案</h3>
        <BillingForm node={node} onSaved={onChanged} />
      </section>

      <section className="drawer-section danger-zone">
        <h3>危险区：下架</h3>
        <RetireZone node={node} onDone={onChanged} />
      </section>
    </Drawer>
  );
}
