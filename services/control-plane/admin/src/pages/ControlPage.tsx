import { useEffect, useMemo, useRef, useState } from 'react';
import { operationsApi } from '../api';
import { useRefresh, useResource } from '../hooks';
import { createExclusiveGate } from '../lib/exclusive';
import { timestamp } from '../lib/format';
import { publishGate } from '../lib/revision';
import { lineDiff } from '../lib/textdiff';
import {
  clearAllDirect,
  clearWebDomains,
  hasWebDomains,
  parseTrafficPolicyText,
} from '../lib/traffic-policy';
import { useOpsWorld } from '../ops-context';
import { usePrivacy } from '../privacy';
import { Banner, Confirm, DataHealth, GlassCard, Skeleton, Unavailable } from '../ui';

type Phase = 'viewing' | 'editing-clean' | 'editing-dirty' | 'confirming' | 'publishing' | 'success' | 'conflict' | 'error';

/**
 * A dirty draft survives navigation by living in sessionStorage, keyed on the
 * frozen base revision. It is only ever restored onto the exact base it was
 * written against — after someone else publishes, the stored copy stays put
 * but never silently reattaches to a different base.
 */
type StoredDraft = { draft: string; baseText: string; base: number };

const YAML_DRAFT_KEY = 'tono-ops-draft-catalog';
const POLICY_DRAFT_KEY = 'tono-ops-draft-policy';

function readStoredDraft(key: string): StoredDraft | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (typeof parsed.draft !== 'string' || typeof parsed.baseText !== 'string' || typeof parsed.base !== 'number') {
      return null;
    }
    return { draft: parsed.draft, baseText: parsed.baseText, base: parsed.base };
  } catch {
    return null;
  }
}

function writeStoredDraft(key: string, value: StoredDraft | null) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch { /* private mode */ }
}

/** The raw phase name is an implementation detail; operators need the meaning. */
const PHASE_LABEL: Record<Phase, string> = {
  viewing: '查看',
  'editing-clean': '编辑中 · 无改动',
  'editing-dirty': '有未发布改动',
  confirming: '待确认',
  publishing: '发布中…',
  success: '已发布',
  conflict: '版本冲突 409',
  error: '发布失败',
};

function DiffView({ diff, revealed }: { diff: ReturnType<typeof lineDiff>; revealed: boolean }) {
  // An empty bordered box under an untouched draft is noise, not information.
  if (diff.added === 0 && diff.removed === 0) return null;
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
  const { refreshMs } = useRefresh();
  const catalog = world.catalog;
  const policy = useResource(operationsApi.trafficPolicy, [], refreshMs ? Math.max(refreshMs, 120_000) : 0);
  const gate = useRef(createExclusiveGate());
  const [yamlDraft, setYamlDraft] = useState('');
  const [yamlBaseText, setYamlBaseText] = useState('');
  const [yamlBase, setYamlBase] = useState<number | null>(null);
  const [yamlPhase, setYamlPhase] = useState<Phase>('viewing');
  const [policyDraft, setPolicyDraft] = useState('');
  const [policyBaseText, setPolicyBaseText] = useState('');
  const [policyBase, setPolicyBase] = useState<number | null>(null);
  const [policyPhase, setPolicyPhase] = useState<Phase>('viewing');
  const [revealYaml, setRevealYaml] = useState(false);
  const [revealPolicy, setRevealPolicy] = useState(false);
  // One banner slot: a later outcome replaces the previous one instead of the
  // two-state pair whose "mutual exclusion" could render neither.
  const [banner, setBanner] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const revisions = useResource(operationsApi.catalogRevisions, [], 0, historyOpen);
  const [confirm, setConfirm] = useState<{
    title: string;
    detail: string;
    target: 'yaml' | 'policy';
    run: () => Promise<void>;
  } | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  useEffect(() => {
    if (privacy.privacy) {
      setRevealYaml(false);
      setRevealPolicy(false);
    }
  }, [privacy.privacy]);

  // Restore a stashed draft once its document is loaded, and only onto the
  // same base revision it was frozen against.
  const restoredYaml = useRef(false);
  useEffect(() => {
    if (restoredYaml.current || catalog.state !== 'ready') return;
    restoredYaml.current = true;
    const stored = readStoredDraft(YAML_DRAFT_KEY);
    if (!stored || stored.base !== catalog.data.revision) return;
    setYamlBaseText(stored.baseText);
    setYamlDraft(stored.draft);
    setYamlBase(stored.base);
    setYamlPhase(stored.draft === stored.baseText ? 'editing-clean' : 'editing-dirty');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.state]);
  const restoredPolicy = useRef(false);
  useEffect(() => {
    if (restoredPolicy.current || policy.state !== 'ready') return;
    restoredPolicy.current = true;
    const stored = readStoredDraft(POLICY_DRAFT_KEY);
    if (!stored || stored.base !== policy.data.revision) return;
    setPolicyBaseText(stored.baseText);
    setPolicyDraft(stored.draft);
    setPolicyBase(stored.base);
    setPolicyPhase(stored.draft === stored.baseText ? 'editing-clean' : 'editing-dirty');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy.state]);

  // Only a dirty draft is worth stashing; a clean or just-published one is the
  // online text again. The initial 'viewing' phase deliberately writes nothing
  // so mounting cannot wipe a stash before the restore above has run.
  useEffect(() => {
    if (yamlPhase === 'editing-dirty' && yamlBase != null) {
      writeStoredDraft(YAML_DRAFT_KEY, { draft: yamlDraft, baseText: yamlBaseText, base: yamlBase });
    } else if (yamlPhase === 'editing-clean' || yamlPhase === 'success') {
      writeStoredDraft(YAML_DRAFT_KEY, null);
    }
  }, [yamlPhase, yamlDraft, yamlBaseText, yamlBase]);
  useEffect(() => {
    if (policyPhase === 'editing-dirty' && policyBase != null) {
      writeStoredDraft(POLICY_DRAFT_KEY, { draft: policyDraft, baseText: policyBaseText, base: policyBase });
    } else if (policyPhase === 'editing-clean' || policyPhase === 'success') {
      writeStoredDraft(POLICY_DRAFT_KEY, null);
    }
  }, [policyPhase, policyDraft, policyBaseText, policyBase]);

  useEffect(() => {
    if (yamlPhase !== 'editing-dirty' && policyPhase !== 'editing-dirty') return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [yamlPhase, policyPhase]);

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
    setBanner(null);
  }

  function startPolicy() {
    if (policy.state !== 'ready') return;
    setPolicyBaseText(policy.data.json);
    setPolicyDraft(policy.data.json);
    setPolicyBase(policy.data.revision);
    setPolicyPhase('editing-clean');
    setBanner(null);
  }

  function changeYaml(text: string) {
    setYamlDraft(text);
    setYamlPhase(text === yamlBaseText ? 'editing-clean' : 'editing-dirty');
  }

  function changePolicy(text: string) {
    setPolicyDraft(text);
    setPolicyPhase(text === policyBaseText ? 'editing-clean' : 'editing-dirty');
  }

  function askAction(title: string, detail: string, target: 'yaml' | 'policy', run: () => Promise<void>) {
    setBanner(null);
    setConfirmError(null);
    setConfirm({ title, detail, target, run });
  }

  async function reloadYaml() {
    const fetchOnline = async () => {
      const data = await catalog.reloadNow();
      setYamlBaseText(data.yaml);
      setYamlDraft(data.yaml);
      setYamlBase(data.revision);
      setYamlPhase('editing-clean');
      setBanner({ tone: 'ok', text: `已加载线上目录 r${data.revision}` });
    };
    if (yamlPhase === 'editing-dirty') {
      askAction('重新加载会丢掉当前草稿', '成功拿到线上版后才会替换编辑框。失败则草稿还在。', 'yaml', fetchOnline);
      return;
    }
    try {
      await fetchOnline();
    } catch (err) {
      setBanner({ tone: 'error', text: err instanceof Error ? err.message : '没加载上来，草稿没动' });
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
      setBanner({ tone: 'ok', text: `已加载线上规则 r${data.revision}` });
    };
    if (policyPhase === 'editing-dirty') {
      askAction('重新加载会丢掉当前草稿', '成功拿到线上版后才会替换编辑框。失败则草稿还在。', 'policy', fetchOnline);
      return;
    }
    try {
      await fetchOnline();
    } catch (err) {
      setBanner({ tone: 'error', text: err instanceof Error ? err.message : '没加载上来，草稿没动' });
      setPolicyPhase((phase) => (phase === 'viewing' ? phase : 'error'));
    }
  }

  // Only the current revision's text exists anywhere — the history table keeps
  // sha256 and counts, not the yaml — so only that one can be loaded. Loading
  // fills the editor; publishing stays a separate, confirmed step.
  function loadRevisionAsDraft(revision: number) {
    if (catalog.state !== 'ready' || catalog.data.revision !== revision) return;
    const data = catalog.data;
    const apply = () => {
      setYamlBaseText(data.yaml);
      setYamlDraft(data.yaml);
      setYamlBase(data.revision);
      setYamlPhase('editing-clean');
      setBanner({ tone: 'ok', text: `已把 r${data.revision} 原文载入编辑框，没有发布` });
    };
    if (yamlPhase === 'editing-dirty') {
      askAction('载入会丢掉当前草稿', `把 r${data.revision} 原文放进编辑框，只作为草稿，不会发布。`, 'yaml', async () => { apply(); });
      return;
    }
    apply();
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
    setBanner({ tone: 'ok', text: `节点目录 r${expected} → r${result.revision}` });
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
    setBanner({ tone: 'ok', text: `国内直连规则 r${expected} → r${result.revision}` });
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
      {banner ? <Banner message={banner.text} tone={banner.tone} /> : null}

      <GlassCard>
        <div className="card-header">
          <div>
            <h2>发布概况</h2>
            <p>线上版本，以及客户端拉到了第几版。</p>
          </div>
        </div>
        <div className="card-body">
          <div className="release-stats">
            <div className="release-stat">
              <span>节点目录</span>
              <strong>{catalogRevision != null ? `r${catalogRevision}` : '未知'}</strong>
              <small>{catalog.state === 'ready' ? timestamp(catalog.data.updatedAt) : catalog.state === 'error' ? '目录源不可用' : '加载中'}</small>
            </div>
            <div className="release-stat">
              <span>直连规则</span>
              <strong>{policyRevision != null ? `r${policyRevision}` : '未知'}</strong>
              <small>{policy.state === 'error' ? '规则源不可用' : policy.state === 'ready' ? '已加载' : '加载中'}</small>
            </div>
            {lagReady ? (
              <>
                <div className="release-stat">
                  <span>客户端最新</span>
                  <strong>{latest}</strong>
                  <small>已经拉到线上版</small>
                </div>
                <div className={`release-stat${behind > 0 ? ' t-severe' : ''}`}>
                  <span>客户端落后</span>
                  <strong style={behind > 0 ? { color: 'hsl(var(--sev-fg))' } : undefined}>{behind}</strong>
                  <small>还在用旧目录</small>
                </div>
                <div className="release-stat">
                  <span>未上报</span>
                  <strong>{unreported}</strong>
                  <small>没说自己在第几版</small>
                </div>
              </>
            ) : (
              <div className="release-stat t-unknown">
                <span>客户端目录版本</span>
                <strong>不可判断</strong>
                <small>心跳源不是 ready</small>
              </div>
            )}
          </div>
        </div>
      </GlassCard>

      <GlassCard>
        {yamlPhase === 'viewing' ? (
          <div className="doc-row">
            <div className="doc-row-main">
              <h2>节点目录 YAML</h2>
              <p>只比较原始文本，不 parse/dump。占位符必须原样保留。</p>
              <div className="doc-meta">
                <span>线上 r{catalogRevision ?? '—'}</span>
                {catalog.state === 'ready' ? <span>{timestamp(catalog.data.updatedAt)}</span> : null}
              </div>
            </div>
            <button className="btn btn-outline btn-sm" type="button" disabled={catalog.state !== 'ready'} onClick={startYaml}>开始编辑</button>
          </div>
        ) : (
          <>
            <div className="card-header">
              <div>
                <h2>节点目录 YAML</h2>
                <p>只比较原始文本，不 parse/dump。占位符必须原样保留。</p>
              </div>
              <span className={`phase-pill t-${yamlPhase === 'conflict' || yamlPhase === 'error' ? 'severe' : yamlPhase === 'success' ? 'ok' : yamlPhase === 'editing-dirty' ? 'warn' : 'info'}`}>
                {PHASE_LABEL[yamlPhase]}
              </span>
            </div>
            <div className="card-body stack">
              <p className="doc-meta">
                <span>基线 r{yamlBase}</span>
                <span>线上 r{catalogRevision ?? '—'}</span>
                {yamlDiff ? <span>+{yamlDiff.added} / −{yamlDiff.removed}</span> : null}
              </p>
              {privacy.privacy && !revealYaml ? (
                <p className="muted">隐私模式隐藏目录原文。</p>
              ) : (
                <textarea
                  className="input control-textarea"
                  aria-label="节点目录 YAML 原文"
                  rows={14}
                  spellCheck={false}
                  value={yamlDraft}
                  onChange={(event) => changeYaml(event.target.value)}
                />
              )}
              {privacy.privacy && (
                <button className="btn btn-outline btn-sm" type="button" onClick={() => setRevealYaml((value) => !value)}>
                  {revealYaml ? '重新隐藏目录原文' : '临时显示目录原文'}
                </button>
              )}
              {yamlDiff && <DiffView diff={yamlDiff} revealed={!privacy.privacy || revealYaml} />}
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
                <button
                  className="btn btn-outline"
                  type="button"
                  disabled={privacy.privacy && !revealYaml}
                  title={privacy.privacy && !revealYaml ? '先临时显示目录原文' : undefined}
                  onClick={() => void navigator.clipboard.writeText(yamlDraft)}
                >复制草稿</button>
                {privacy.privacy && !revealYaml
                  ? <button className="btn btn-outline" type="button" disabled title="先临时显示目录原文">下载草稿</button>
                  : <a className="btn btn-outline" href={`data:text/yaml;charset=utf-8,${encodeURIComponent(yamlDraft)}`} download="tono-catalog.yaml">下载草稿</a>}
                <button className="btn btn-outline" type="button" onClick={() => void reloadYaml()}>重新加载线上版</button>
              </div>
            </div>
          </>
        )}
      </GlassCard>

      <GlassCard>
        {policyPhase === 'viewing' ? (
          <div className="doc-row">
            <div className="doc-row-main">
              <h2>国内直连规则 JSON</h2>
              <p>diff 比较原始编辑文本。加载时不 pretty-print。</p>
              <div className="doc-meta"><span>线上 r{policyRevision ?? '—'}</span></div>
            </div>
            <button className="btn btn-outline btn-sm" type="button" disabled={policy.state !== 'ready'} onClick={startPolicy}>开始编辑</button>
          </div>
        ) : (
          <>
            <div className="card-header">
              <div>
                <h2>国内直连规则 JSON</h2>
                <p>diff 比较原始编辑文本。加载时不 pretty-print。</p>
              </div>
              <span className={`phase-pill t-${policyPhase === 'conflict' || policyPhase === 'error' ? 'severe' : policyPhase === 'success' ? 'ok' : policyPhase === 'editing-dirty' ? 'warn' : 'info'}`}>
                {PHASE_LABEL[policyPhase]}
              </span>
            </div>
            <div className="card-body stack">
              <p className="doc-meta">
                <span>基线 r{policyBase}</span>
                <span>线上 r{policyRevision ?? '—'}</span>
                {policyDiff ? <span>+{policyDiff.added} / −{policyDiff.removed}</span> : null}
              </p>
              {privacy.privacy && !revealPolicy ? (
                <p className="muted">隐私模式隐藏规则原文。</p>
              ) : (
                <textarea
                  className="input control-textarea"
                  aria-label="国内直连规则 JSON 原文"
                  rows={12}
                  spellCheck={false}
                  value={policyDraft}
                  onChange={(event) => changePolicy(event.target.value)}
                />
              )}
              {privacy.privacy && (
                <button className="btn btn-outline btn-sm" type="button" onClick={() => setRevealPolicy((value) => !value)}>
                  {revealPolicy ? '重新隐藏规则原文' : '临时显示规则原文'}
                </button>
              )}
              {policyDiff && <DiffView diff={policyDiff} revealed={!privacy.privacy || revealPolicy} />}
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
                      setBanner({ tone: 'error', text: parsedDraft.reason });
                      return;
                    }
                    const cleared = clearWebDomains(parsedDraft.policy);
                    if (!cleared.ok) {
                      setBanner({ tone: 'error', text: cleared.reason });
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
                  disabled={publishing || !parsedDraft.ok}
                  title={!parsedDraft.ok ? parsedDraft.reason : undefined}
                  onClick={() => {
                    if (!parsedDraft.ok) {
                      setBanner({ tone: 'error', text: parsedDraft.reason });
                      return;
                    }
                    const next = clearAllDirect(parsedDraft.policy);
                    const text = JSON.stringify(next);
                    const diff = lineDiff(policyDraft, text);
                    askAction(
                      '关闭全部直连',
                      `清空 v${next.version} 规则的全部直连列表（+${diff.added}/−${diff.removed}），不改 version。客户端会安全重连。`,
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
            </div>
          </>
        )}
      </GlassCard>

      <GlassCard>
        <div className="card-body">
          <details className="control-history" onToggle={(event) => setHistoryOpen(event.currentTarget.open)}>
            <summary>历史版本 · 展开才拉取发布记录</summary>
            {historyOpen && (
              revisions.state === 'error' ? (
                <Unavailable title="发布记录不可用" detail={revisions.message} />
              ) : revisions.state === 'loading' ? (
                <Skeleton label="发布记录" />
              ) : revisions.data.length === 0 ? (
                <p className="muted">还没有发布记录。</p>
              ) : (
                <>
                  <div className="control-history-list">
                    {revisions.data.map((rev) => (
                      <div className="control-history-row" key={rev.revision}>
                        <span className="mono">r{rev.revision}</span>
                        {rev.current ? <span className="phase-pill t-ok">当前线上</span> : null}
                        <span className="muted">{timestamp(rev.publishedAt)}</span>
                        <span className="muted">{rev.serverCount} 台机器 · {rev.logicalNodeCount} 节点 · {rev.deploymentCount} 部署</span>
                        <span className="mono muted" title={rev.sha256}>{rev.sha256.slice(0, 10)}</span>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          disabled={!rev.current || catalog.state !== 'ready'}
                          title={rev.current ? '把线上原文放进编辑框，不会发布' : '历史修订只存了摘要，原文未存档，载入不了'}
                          onClick={() => loadRevisionAsDraft(rev.revision)}
                        >载入为草稿</button>
                      </div>
                    ))}
                  </div>
                  <p className="muted">载入只替换编辑框草稿，从不自动发布。历史修订没有存原文，只能对照时间、数量和 sha256。</p>
                </>
              )
            )}
          </details>
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
          setBanner(null);
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
