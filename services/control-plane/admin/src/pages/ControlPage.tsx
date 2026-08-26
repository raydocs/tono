import { useEffect, useMemo, useRef, useState } from 'react';
import { operationsApi } from '../api';
import { useResource } from '../hooks';
import { createExclusiveGate } from '../lib/exclusive';
import { timestamp } from '../lib/format';
import { publishGate } from '../lib/revision';
import { lineDiff } from '../lib/textdiff';
import {
  clearWebDomains,
  emptyDirectPolicy,
  hasWebDomains,
  parseTrafficPolicyText,
} from '../lib/traffic-policy';
import { useOpsWorld } from '../ops-context';
import { usePrivacy } from '../privacy';
import { Banner, Confirm, DataHealth, GlassCard } from '../ui';

type Phase = 'viewing' | 'editing-clean' | 'editing-dirty' | 'confirming' | 'publishing' | 'success' | 'conflict' | 'error';

function DiffView({ diff, revealed }: { diff: ReturnType<typeof lineDiff>; revealed: boolean }) {
  if (!revealed) return <p className="muted">隐私模式已隐藏 diff 原文。提交仍使用原始草稿。</p>;
  return (
    <div className="text-diff">
      <p className="muted">+{diff.added} / −{diff.removed}{diff.truncated ? ' · 只渲染部分 hunk' : ''}</p>
      {diff.hunks.map((hunk, index) => (
        <pre key={index} className="diff-hunk">
          {hunk.lines.map((line, lineIndex) => (
            <span key={lineIndex} className={`diff-${line.kind}`}>{line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}{line.text}{'\n'}</span>
          ))}
        </pre>
      ))}
    </div>
  );
}

export function ControlPage() {
  const world = useOpsWorld();
  const privacy = usePrivacy();
  const catalog = world.catalog;
  const policy = useResource(operationsApi.trafficPolicy, [], 120_000);
  const gate = useRef(createExclusiveGate());
  const [yamlDraft, setYamlDraft] = useState('');
  const [yamlBaseText, setYamlBaseText] = useState('');
  const [yamlBase, setYamlBase] = useState<number | null>(null);
  const [yamlPhase, setYamlPhase] = useState<Phase>('viewing');
  const [policyDraft, setPolicyDraft] = useState('');
  const [policyBaseText, setPolicyBaseText] = useState('');
  const [policyBase, setPolicyBase] = useState<number | null>(null);
  const [policyPhase, setPolicyPhase] = useState<Phase>('viewing');
  const [reveal, setReveal] = useState(!privacy.privacy);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    detail: string;
    target: 'yaml' | 'policy';
    run: () => Promise<void>;
  } | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  useEffect(() => {
    if (privacy.privacy) setReveal(false);
  }, [privacy.privacy]);

  const catalogRevision = catalog.state === 'ready' ? catalog.data.revision : null;
  const policyRevision = policy.state === 'ready' ? policy.data.revision : null;
  const catalogGate = publishGate(yamlBase, catalogRevision);
  const policyGate = publishGate(policyBase, policyRevision);
  const behind = world.people.filter((person) => person.catalogLag.state === 'behind').length;
  const latest = world.people.filter((person) => person.catalogLag.state === 'current').length;
  const unreported = world.people.filter((person) => person.catalogLag.state === 'unreported').length;
  const yamlDiff = useMemo(
    () => (yamlPhase === 'viewing' ? null : lineDiff(yamlBaseText, yamlDraft)),
    [yamlPhase, yamlBaseText, yamlDraft],
  );
  const policyDiff = useMemo(
    () => (policyPhase === 'viewing' ? null : lineDiff(policyBaseText, policyDraft)),
    [policyPhase, policyBaseText, policyDraft],
  );
  const parsedDraft = useMemo(() => parseTrafficPolicyText(policyDraft), [policyDraft]);
  const webDirectDisabled = !parsedDraft.ok || parsedDraft.policy.version === 1 || !hasWebDomains(parsedDraft.policy);

  function startYaml() {
    if (catalog.state !== 'ready') return;
    setYamlBaseText(catalog.data.yaml);
    setYamlDraft(catalog.data.yaml);
    setYamlBase(catalog.data.revision);
    setYamlPhase('editing-clean');
    setError(null);
    setMessage(null);
  }

  function startPolicy() {
    if (policy.state !== 'ready') return;
    setPolicyBaseText(policy.data.json);
    setPolicyDraft(policy.data.json);
    setPolicyBase(policy.data.revision);
    setPolicyPhase('editing-clean');
    setError(null);
    setMessage(null);
  }

  function changeYaml(text: string) {
    setYamlDraft(text);
    setYamlPhase(text === yamlBaseText ? 'editing-clean' : 'editing-dirty');
  }

  function changePolicy(text: string) {
    setPolicyDraft(text);
    setPolicyPhase(text === policyBaseText ? 'editing-clean' : 'editing-dirty');
  }

  async function reloadYaml() {
    const fetchOnline = async () => {
      const data = await catalog.reloadNow();
      setYamlBaseText(data.yaml);
      setYamlDraft(data.yaml);
      setYamlBase(data.revision);
      setYamlPhase('editing-clean');
      setError(null);
      setMessage(`已加载线上目录 r${data.revision}`);
    };
    if (yamlPhase === 'editing-dirty') {
      setConfirm({
        title: '重新加载会丢掉当前草稿',
        detail: '成功拿到线上版后才会替换编辑框。失败则草稿还在。',
        target: 'yaml',
        run: fetchOnline,
      });
      return;
    }
    try {
      await fetchOnline();
    } catch (err) {
      setError(err instanceof Error ? err.message : '没加载上来，草稿没动');
      setYamlPhase((phase) => (phase === 'viewing' ? phase : 'error'));
    }
  }

  async function reloadPolicy() {
    const fetchOnline = async () => {
      const data = await policy.reloadNow();
      setPolicyBaseText(data.json);
      setPolicyDraft(data.json);
      setPolicyBase(data.revision);
      setPolicyPhase('editing-clean');
      setError(null);
      setMessage(`已加载线上规则 r${data.revision}`);
    };
    if (policyPhase === 'editing-dirty') {
      setConfirm({
        title: '重新加载会丢掉当前草稿',
        detail: '成功拿到线上版后才会替换编辑框。失败则草稿还在。',
        target: 'policy',
        run: fetchOnline,
      });
      return;
    }
    try {
      await fetchOnline();
    } catch (err) {
      setError(err instanceof Error ? err.message : '没加载上来，草稿没动');
      setPolicyPhase((phase) => (phase === 'viewing' ? phase : 'error'));
    }
  }

  function askAction(title: string, detail: string, target: 'yaml' | 'policy', run: () => Promise<void>) {
    setMessage(null);
    setError(null);
    setConfirmError(null);
    setConfirm({ title, detail, target, run });
  }

  async function publishYaml() {
    if (!catalogGate.allow) {
      setConfirmError(catalogGate.reason);
      throw new Error(catalogGate.reason);
    }
    const expected = catalogGate.expectedRevision;
    const result = await operationsApi.replaceCatalog(yamlDraft, expected);
    setYamlBase(result.revision);
    setYamlBaseText(yamlDraft);
    setYamlPhase('success');
    setMessage(`节点目录 r${expected} → r${result.revision}`);
    catalog.reload();
  }

  async function publishPolicyObject(next: unknown, draftText: string) {
    if (!policyGate.allow) {
      setConfirmError(policyGate.reason);
      throw new Error(policyGate.reason);
    }
    const expected = policyGate.expectedRevision;
    const result = await operationsApi.replaceTrafficPolicy(next, expected);
    setPolicyDraft(draftText);
    setPolicyBaseText(draftText);
    setPolicyBase(result.revision);
    setPolicyPhase('success');
    setMessage(`国内直连规则 r${expected} → r${result.revision}`);
    policy.reload();
  }

  async function savePolicyFromDraft() {
    const parsed = parseTrafficPolicyText(policyDraft);
    if (!parsed.ok) {
      setConfirmError(parsed.reason);
      throw new Error(parsed.reason);
    }
    await publishPolicyObject(parsed.policy, policyDraft);
  }

  const lagReady = world.activity.state === 'ready';
  const publishing = yamlPhase === 'publishing' || policyPhase === 'publishing' || confirmBusy;

  return (
    <div className="stack">
      <DataHealth sources={[
        { label: '节点目录', resource: catalog },
        { label: '直连规则', resource: policy },
        { label: '客户心跳', resource: world.activity },
      ]} />
      {error && !message ? <Banner message={error} tone="error" /> : null}
      {message && !error ? <Banner message={message} tone="ok" /> : null}

      <GlassCard>
        <div className="card-header">
          <div>
            <h2>发布概况</h2>
            <p>
              目录 {catalogRevision != null ? `r${catalogRevision}` : '未知'}
              {catalog.state === 'ready' ? ` · ${timestamp(catalog.data.updatedAt)}` : ''}
              {' · '}规则 {policyRevision != null ? `r${policyRevision}` : '未知'}
            </p>
          </div>
        </div>
        <div className="card-body">
          {lagReady ? (
            <p>客户目录：最新 {latest} · 落后 {behind} · 未上报 {unreported}</p>
          ) : (
            <p className="muted">目录落后人数不可判断，心跳源不是 ready。</p>
          )}
          {catalog.state === 'error' && <p>目录源不可用。</p>}
          {policy.state === 'error' && <p>规则源不可用。</p>}
        </div>
      </GlassCard>

      <GlassCard>
        <div className="card-header">
          <div>
            <h2>节点目录 YAML</h2>
            <p>只比较原始文本，不 parse/dump。占位符必须原样保留。</p>
          </div>
        </div>
        <div className="card-body stack">
          {yamlPhase === 'viewing' ? (
            <button className="btn" type="button" disabled={catalog.state !== 'ready'} onClick={startYaml}>开始编辑</button>
          ) : (
            <>
              <p className="muted">状态 {yamlPhase} · 基线 r{yamlBase} · 线上 r{catalogRevision ?? '—'}</p>
              {privacy.privacy && !reveal ? (
                <p className="muted">隐私模式隐藏目录原文。</p>
              ) : (
                <textarea
                  className="input control-textarea"
                  rows={14}
                  spellCheck={false}
                  value={yamlDraft}
                  onChange={(event) => changeYaml(event.target.value)}
                />
              )}
              {privacy.privacy && (
                <button className="btn btn-outline btn-sm" type="button" onClick={() => setReveal((value) => !value)}>
                  {reveal ? '重新隐藏原文' : '临时显示原文'}
                </button>
              )}
              {yamlDiff && <DiffView diff={yamlDiff} revealed={!privacy.privacy || reveal} />}
              <div className="form-actions">
                <button
                  className="btn"
                  type="button"
                  disabled={publishing || yamlDraft === yamlBaseText || !catalogGate.allow}
                  onClick={() => askAction(
                    '发布节点目录',
                    `基线 r${yamlBase}，线上 r${catalogRevision}，+${yamlDiff?.added ?? 0}/−${yamlDiff?.removed ?? 0}${catalogGate.allow && catalogGate.drifted ? '，已发生 drift' : ''}。发布后客户会拉新目录。`,
                    'yaml',
                    publishYaml,
                  )}
                >对照 diff 发布</button>
                <button className="btn btn-outline" type="button" onClick={() => void navigator.clipboard.writeText(yamlDraft)}>复制草稿</button>
                <a className="btn btn-outline" href={`data:text/yaml;charset=utf-8,${encodeURIComponent(yamlDraft)}`} download="tono-catalog.yaml">下载草稿</a>
                <button className="btn btn-outline" type="button" onClick={() => void reloadYaml()}>重新加载线上版</button>
              </div>
            </>
          )}
        </div>
      </GlassCard>

      <GlassCard>
        <div className="card-header">
          <div>
            <h2>国内直连规则 JSON</h2>
            <p>diff 比较原始编辑文本。加载时不 pretty-print。</p>
          </div>
        </div>
        <div className="card-body stack">
          {policyPhase === 'viewing' ? (
            <button className="btn" type="button" disabled={policy.state !== 'ready'} onClick={startPolicy}>开始编辑</button>
          ) : (
            <>
              <p className="muted">状态 {policyPhase} · 基线 r{policyBase} · 线上 r{policyRevision ?? '—'}</p>
              {privacy.privacy && !reveal ? (
                <p className="muted">隐私模式隐藏规则原文。</p>
              ) : (
                <textarea
                  className="input control-textarea"
                  rows={12}
                  spellCheck={false}
                  value={policyDraft}
                  onChange={(event) => changePolicy(event.target.value)}
                />
              )}
              {policyDiff && <DiffView diff={policyDiff} revealed={!privacy.privacy || reveal} />}
              <div className="form-actions">
                <button
                  className="btn"
                  type="button"
                  disabled={publishing || policyDraft === policyBaseText}
                  onClick={() => askAction(
                    '发布直连规则',
                    `基线 r${policyBase}，线上 r${policyRevision}，+${policyDiff?.added ?? 0}/−${policyDiff?.removed ?? 0}。保存后客户端安全重连。`,
                    'policy',
                    savePolicyFromDraft,
                  )}
                >对照 diff 保存</button>
                <button
                  className="btn btn-outline"
                  type="button"
                  disabled={publishing || webDirectDisabled}
                  title={!parsedDraft.ok ? parsedDraft.reason : parsedDraft.policy.version === 1 ? '当前没有网页直连规则' : undefined}
                  onClick={() => {
                    if (!parsedDraft.ok) {
                      setError(parsedDraft.reason);
                      return;
                    }
                    const cleared = clearWebDomains(parsedDraft.policy);
                    if (!cleared.ok) {
                      setError(cleared.reason);
                      return;
                    }
                    const text = JSON.stringify(cleared.policy);
                    const diff = lineDiff(policyDraft, text);
                    askAction(
                      '关闭网页直连',
                      `保留原生应用直连和 TCP 端点。基线 r${policyBase}。+${diff.added}/−${diff.removed}。不清空 webDomains 以外的字段，也不改 version。`,
                      'policy',
                      async () => {
                        setPolicyDraft(text);
                        await publishPolicyObject(cleared.policy, text);
                      },
                    );
                  }}
                >关闭网页直连</button>
                <button
                  className="btn btn-outline"
                  type="button"
                  disabled={publishing}
                  onClick={() => {
                    const next = emptyDirectPolicy();
                    const text = JSON.stringify(next);
                    const diff = lineDiff(policyDraft, text);
                    askAction(
                      '关闭全部直连',
                      `将发布空的 v1 规则（+${diff.added}/−${diff.removed}）。客户端会安全重连。`,
                      'policy',
                      async () => {
                        setPolicyDraft(text);
                        await publishPolicyObject(next, text);
                      },
                    );
                  }}
                >关掉全部直连</button>
                <button className="btn btn-outline" type="button" onClick={() => void reloadPolicy()}>重新加载</button>
              </div>
            </>
          )}
        </div>
      </GlassCard>

      <Confirm
        open={Boolean(confirm)}
        title={confirm?.title ?? ''}
        detail={confirm?.detail}
        busy={publishing}
        error={confirmError}
        onCancel={() => { if (!publishing) { setConfirm(null); setConfirmError(null); } }}
        onConfirm={async () => {
          if (!confirm || gate.current.busy || confirmBusy) return;
          const target = confirm.target;
          setConfirmBusy(true);
          setConfirmError(null);
          setError(null);
          setMessage(null);
          if (target === 'policy') setPolicyPhase('publishing');
          else setYamlPhase('publishing');
          try {
            const ran = await gate.current.run(confirm.run);
            if (ran) {
              setConfirm(null);
              setConfirmError(null);
            }
          } catch (err) {
            const text = err instanceof Error ? err.message : '没做成';
            if (/\(409\)|revision|冲突/.test(text)) {
              setConfirmError(`${text}。草稿和冻结的基线还在，请重新对照后再发。`);
              if (target === 'policy') setPolicyPhase('conflict');
              else setYamlPhase('conflict');
            } else {
              setConfirmError(text);
              if (target === 'policy') setPolicyPhase('error');
              else setYamlPhase('error');
            }
          } finally {
            setConfirmBusy(false);
          }
        }}
      />
    </div>
  );
}
