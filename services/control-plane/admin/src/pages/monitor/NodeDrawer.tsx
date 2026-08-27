import { useEffect, useRef, useState } from 'react';
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
import { Banner, Drawer, DrawerSection, Field, FieldGrid, Note, Stat, StatGrid } from '../../ui';

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
  if (!metrics) return <Note>24h 趋势还没绑定到当前快照。</Note>;
  const points = metrics.series[name];
  if (!points || points.length < 2) return <Note>这台只有 {points?.length ?? 0} 个趋势点，两点之间才画得出线。</Note>;
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

function BillingForm({
  node,
  onSaved,
  focusRenew = false,
}: {
  node: OpsNodeView;
  onSaved: () => void;
  focusRenew?: boolean;
}) {
  const privacy = usePrivacy();
  const profile = node.profile;
  const agent = node.agent;
  const renewInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(profile?.billingUrl ?? '');
  const [quota, setQuota] = useState(profile?.trafficQuotaBytes != null ? String(Math.round(profile.trafficQuotaBytes / (1024 ** 3))) : '');
  const [used, setUsed] = useState(profile?.trafficUsedBytes != null ? String(Math.round(profile.trafficUsedBytes / (1024 ** 3))) : '');
  const [renew, setRenew] = useState(profile?.renewsAt ? new Date(profile.renewsAt * 1000).toISOString().slice(0, 10) : '');
  const [price, setPrice] = useState(profile?.price != null ? String(profile.price) : '');
  const [currency, setCurrency] = useState(profile?.currency ?? '');
  const [billingCycle, setBillingCycle] = useState(profile?.billingCycle != null ? String(profile.billingCycle) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!focusRenew) return;
    const id = window.setTimeout(() => renewInput.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [focusRenew, node.name]);

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
        <p className="field-hint">
          当前：{billing.price != null ? privacy.money(`${billing.currency || ''}${billing.price}`) : '没有价格'}
          {billing.billingCycle ? ` · ${billing.billingCycle} 天一期` : ''}
          {billing.source === 'komari' ? ' · 来自 Komari' : billing.source === 'mixed' ? ' · 自己填的优先，缺的用 Komari 补' : ' · 自己填的'}
        </p>
      )}
      <FieldGrid>
        <Field label="账单页">
          <input className="input compact sensitive-value" placeholder="https://…" value={url} onChange={(event) => setUrl(event.target.value)} />
        </Field>
        <Field label="价格">
          <input className="input compact sensitive-value" placeholder="5.5" value={price} onChange={(event) => setPrice(event.target.value)} />
        </Field>
        <Field label="货币">
          <input className="input compact" placeholder="USD" value={currency} onChange={(event) => setCurrency(event.target.value)} />
        </Field>
        <Field label="账期天数">
          <input className="input compact" type="number" min={1} placeholder="30" value={billingCycle} onChange={(event) => setBillingCycle(event.target.value)} />
        </Field>
        <Field label="套餐 GB">
          <input className="input compact" type="number" min={0} placeholder="1024" value={quota} onChange={(event) => setQuota(event.target.value)} />
        </Field>
        <Field label="已用 GB" hint="手填，会覆盖探针差分">
          <input className="input compact" type="number" min={0} value={used} onChange={(event) => setUsed(event.target.value)} />
        </Field>
        <Field label="续费日期">
          <input
            ref={renewInput}
            className="input compact"
            type="date"
            value={renew}
            onChange={(event) => setRenew(event.target.value)}
          />
        </Field>
      </FieldGrid>
      <p className="field-hint">某项要清空：把格子清空再保存。填错不会被当成清空。普通保存不会移动本期基线。</p>
      <div className="row-actions">
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
          privacy.privacy
            ? <span className="field-hint">隐私模式下隐藏账单链接。</span>
            : <a className="btn btn-outline btn-sm" href={profile.billingUrl} target="_blank" rel="noreferrer">打开账单</a>
        )}
      </div>
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
    return <Note>不在客户目录里，没有下架动作。</Note>;
  }

  return (
    <div className="stack">
      <Banner message={error} tone="error" />
      <Banner message={message} tone="ok" />
      <Note tone="severe">下架会把这台从客户目录里去掉。先预览，看清受影响的人，再输全名确认。</Note>
      <div className="row-actions">
        <button className="btn btn-outline btn-danger btn-sm" type="button" disabled={loading || busy} onClick={() => void loadPreview()}>
          {loading ? '生成预览…' : preview ? '重新预览' : '预览下架'}
        </button>
      </div>
      {preview && (
        <>
          <Note tone="info">冻结目录 r{preview.expectedRevision}。确认时会再核对这个版本。</Note>
          <StatGrid columns={3}>
            <Stat label="受影响客户" value={preview.affectedUsers.length} tone={preview.affectedUsers.length > 0 ? 'severe' : undefined} />
            <Stat label="代理组引用移除" value={preview.changes.proxyGroupReferencesRemoved.length} />
            <Stat label="账单档案" value={preview.changes.profileMarkedRetired ? '标记退役' : '不改' } />
          </StatGrid>
          {preview.affectedUsers.length > 0 && (
            <ul className="fact-list affected-users">
              {preview.affectedUsers.map((user) => (
                <li key={`${user.userId}-${user.deviceId}`}>
                  <span className={`chip ${user.online ? 'chip-warn' : 'chip-unknown'}`}>{user.online ? '在线' : '离线'}</span>
                  <strong>{privacy.email(user.email)}</strong>
                </li>
              ))}
            </ul>
          )}
          {preview.warnings.map((warning) => <div className="banner banner-info" key={warning}>{warning}</div>)}
          {!preview.canRetire && <Banner tone="error" message="后端判定当前不能安全下架；请处理上面的阻断项后重新预览。" />}
          <Field label="下架原因" hint="会写入操作记录">
            <textarea className="input" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：整机失联，已确认从客户目录停售" />
          </Field>
          <Field label="输入节点全名确认" hint={<>要一字不差地输入 <code>{preview.node.name}</code></>}>
            <input className="input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
          </Field>
          <div className="row-actions">
            <button
              className="btn btn-destructive"
              type="button"
              disabled={busy || !preview.canRetire || confirmation !== preview.node.name || !reason.trim()}
              onClick={() => void retire()}
            >
              {busy ? '正在下架…' : '确认从目录下架'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function NodeDrawer({
  node,
  open,
  metrics,
  focus = null,
  onClose,
  onChanged,
}: {
  node: OpsNodeView | null;
  open: boolean;
  metrics: MetricsDto | null;
  focus?: string | null;
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
      <section className="drawer-section drawer-hero">
        <div className="drawer-hero-top">
          <span className={`nc-state nc-tone-${node.dot}`}>
            <span className={`nc-dot nc-dot-${node.dot}`} aria-hidden />
            {node.blockLabel}
          </span>
          <span className="drawer-hero-ip mono">{privacy.ip(ip)}{agent?.os ? ` · ${agent.os}` : ''}</span>
        </div>
        <StatGrid columns={3}>
          <Stat label="目录" value={catalogLine(node)} />
          <Stat label="占用" value={occupancyLine(node)} tone={node.occupancyState === 'known' ? undefined : 'unknown'} />
          <Stat label="探针" value={agentLine(node)} tone={node.agentState === 'reported' ? undefined : 'unknown'} />
        </StatGrid>
        {node.signals.length > 0 && (
          <div className="chip-list">
            {node.signals.map((signal) => (
              <span className={`chip${signal.severity >= 3 ? ' chip-risk' : ' chip-warn'}`} key={signal.label}>{signal.label}</span>
            ))}
          </div>
        )}
        {node.pathSummary && (node.pathSummary.worstExitMs != null || node.pathSummary.worstTcpMs != null) && (
          <StatGrid columns={2}>
            <Stat
              label="客户路径最差 · 出口"
              value={node.pathSummary.worstExitMs != null ? `${node.pathSummary.worstExitMs} ms` : '未测'}
            />
            <Stat
              label="客户路径最差 · TCP"
              value={node.pathSummary.worstTcpMs != null ? `${node.pathSummary.worstTcpMs} ms` : '未测'}
            />
          </StatGrid>
        )}
      </section>

      <DrawerSection title="资源与运行时间">
        {node.agentState === 'unavailable' ? (
          <Note>探针源不可用，不能判断 CPU / 内存 / 流量。空着不是 0。</Note>
        ) : node.agentState === 'unreported' ? (
          <Note>没装探针，这台没有 CPU / 内存 / 硬盘 / 累计流量读数。</Note>
        ) : agent ? (
          <StatGrid>
            <Stat label="CPU" value={agent.cpu == null ? '—' : `${Math.round(agent.cpu)}%`} note={agent.load1 == null ? undefined : `load ${agent.load1.toFixed(2)}`} />
            <Stat
              label="内存"
              value={agent.memUsed != null && agent.memTotal != null ? `${Math.round((agent.memUsed / agent.memTotal) * 100)}%` : '—'}
              note={agent.memUsed != null && agent.memTotal != null ? `${formatBytes(agent.memUsed)} / ${formatBytes(agent.memTotal)}` : '未上报'}
            />
            <Stat
              label="硬盘"
              value={agent.diskUsed != null && agent.diskTotal != null ? `${Math.round((agent.diskUsed / agent.diskTotal) * 100)}%` : '—'}
              note={agent.diskUsed != null && agent.diskTotal != null ? `${formatBytes(agent.diskUsed)} / ${formatBytes(agent.diskTotal)}` : '未上报'}
            />
            <Stat label="运行" value={agent.uptime != null ? formatDuration(agent.uptime) : '—'} />
            <Stat label="累计 ↓" value={agent.netIn == null ? '—' : formatBytes(agent.netIn)} note="计数器，不是速度" />
            <Stat label="累计 ↑" value={agent.netOut == null ? '—' : formatBytes(agent.netOut)} note="计数器，不是速度" />
          </StatGrid>
        ) : null}
      </DrawerSection>

      <DrawerSection title="三网与大陆可达">
        {node.qualityState === 'unavailable' ? (
          <Note>质量源不可用，不能把空着当成没被墙。</Note>
        ) : node.qualityState === 'unmeasured' ? (
          <Note>大陆没测。不是好，只是没测。</Note>
        ) : quality?.block?.rule ? (
          <Note tone="info">{quality.block.rule}</Note>
        ) : null}
        {node.agentState === 'unavailable' ? (
          <Note>三网源不可用。</Note>
        ) : (
          <CarrierPing carriers={agent?.carriers ?? null} />
        )}
      </DrawerSection>

      <DrawerSection title="24h 趋势">
        <NodeTrends metrics={metrics} name={node.name} />
      </DrawerSection>

      <DrawerSection
        title="谁在使用"
        aside={node.occupancyState === 'known' ? `${node.occupants.length} 人` : '不可判断'}
      >
        {node.occupancyState !== 'known' ? (
          <Note>占用不可判断，心跳源没回来。这不是「没人用」。</Note>
        ) : node.occupants.length === 0 ? (
          <Note>现在没人连这台。</Note>
        ) : (
          <div className="chip-list">
            {node.occupants.map((user) => (
              <a className="chip chip-link" key={user.userId} href={`#/users?user=${encodeURIComponent(user.userId)}`}>
                {privacy.email(user.email)}
              </a>
            ))}
          </div>
        )}
      </DrawerSection>

      <DrawerSection
        title="端口与风险"
        aside={quality?.exposure && quality.exposure.unexpected.length > 0
          ? <span className="pill-count t-severe">{quality.exposure.unexpected.length} 个意外端口</span>
          : undefined}
      >
        {node.qualityState === 'unavailable' ? (
          <Note>质量源不可用，没有端口扫描结果。</Note>
        ) : !quality?.exposure ? (
          <Note>还没扫过端口。空着不代表安全。</Note>
        ) : quality.exposure.unexpected.length === 0 ? (
          <Note tone="ok">对外只开了 SSH（:{quality.exposure.sshPorts.join('、:') || '—'}）和服务端口。</Note>
        ) : (
          <div className="chip-list">
            {quality.exposure.unexpected.map((listener) => (
              <span className="chip chip-bad" key={`exp-${listener.port}`}>
                :{listener.port}{listener.process ? ` ${listener.process}` : ''}
              </span>
            ))}
          </div>
        )}
        {quality?.exposure && quality.exposure.acknowledged.length > 0 && (
          <ul className="fact-list">
            {quality.exposure.acknowledged.map((listener) => (
              <li key={`ack-${listener.port}`}>
                <span className="chip chip-unknown">已允许 :{listener.port}</span>
                <span>{listener.process || '未知进程'}{listener.reason ? ` —— ${listener.reason}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
        {quality && quality.riskSignals.length > 0 && (
          <>
            <ul className="fact-list">
              {quality.riskSignals.map((signal) => (
                <li key={`sig-${signal.tag}`}>
                  <span className={`chip ${quality.riskKeywords.includes(signal.tag) ? 'chip-warn' : 'chip-unknown'}`}>
                    {RISK_SIGNAL_LABELS[signal.tag] ?? signal.tag}
                  </span>
                  <span>
                    {signal.no === 0
                      ? `${signal.yes} 家标了这个`
                      : `${signal.yes} 家说是，${signal.no} 家说不是`}
                    {quality.riskKeywords.includes(signal.tag) ? ' · 算' : ' · 证据不够，先不算'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="field-hint">查过 17 家名单，少数说有问题先不算。</p>
          </>
        )}
        {!privacy.privacy && (quality?.backtrace || quality?.securityCheck) ? (
          <details className="raw-fold">
            <summary>线路 / 黑名单原文</summary>
            <pre>{quality.backtrace || '无'}</pre>
            <pre>{quality.securityCheck || '无'}</pre>
          </details>
        ) : privacy.privacy ? (
          <Note>隐私模式已隐藏原始 backtrace / securityCheck。</Note>
        ) : null}
      </DrawerSection>

      <DrawerSection
        title="账单档案"
        fold
        open={focus === 'unfilled-renew' || node.billing.renewsAt == null || node.billing.source === 'none'}
      >
        <BillingForm node={node} onSaved={onChanged} focusRenew={focus === 'unfilled-renew'} />
      </DrawerSection>

      <DrawerSection title="危险区：下架" danger>
        <RetireZone node={node} onDone={onChanged} />
      </DrawerSection>
    </Drawer>
  );
}
