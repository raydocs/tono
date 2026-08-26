import { useEffect, useRef, useState } from 'react';
import { operationsApi } from '../api';
import { useResource } from '../hooks';
import { createExclusiveGate } from '../lib/exclusive';
import { timestamp } from '../lib/format';
import { publishGate } from '../lib/revision';
import { lineDiff, type LineDiff } from '../lib/textdiff';
import { useOpsWorld } from '../ops-context';
import { usePrivacy } from '../privacy';
import { Banner, Confirm, DataHealth, GlassCard } from '../ui';

type Phase = 'viewing' | 'editing-clean' | 'editing-dirty' | 'confirming' | 'publishing' | 'success' | 'conflict' | 'error';

function DiffView({ diff, revealed }: { diff: LineDiff; revealed: boolean }) {
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
  const [confirm, setConfirm] = useState<{ title: string; detail: string; run: () => Promise<void> } | null>(null);

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
  const yamlDiff = yamlPhase === 'viewing' ? null : lineDiff(yamlBaseText, yamlDraft);
  const policyDiff = policyPhase === 'viewing' ? null : lineDiff(policyBaseText, policyDraft);

  function startYaml() {
    if (catalog.state !== 'ready') return;
    setYamlBaseText(catalog.data.yaml);
    setYamlDraft(catalog.data.yaml);
    setYamlBase(catalog.data.revision);
    setYamlPhase('editing-clean');
    setError(null);
  }

  function startPolicy() {
    if (policy.state !== 'ready') return;
    setPolicyBaseText(policy.data.json);
    setPolicyDraft(policy.data.json);
    setPolicyBase(policy.data.revision);
    setPolicyPhase('editing-clean');
    setError(null);
  }

  function changeYaml(text: string) {
    setYamlDraft(text);
    setYamlPhase(text === yamlBaseText ? 'editing-clean' : 'editing-dirty');
  }

  function changePolicy(text: string) {
    setPolicyDraft(text);
    setPolicyPhase(text === policyBaseText ? 'editing-clean' : 'editing-dirty');
  }

  async function reloadYaml(force = false) {
    if (!force && yamlPhase === 'editing-dirty') {
      setConfirm({
        title: '重新加载会丢掉当前草稿',
        detail: '线上目录会覆盖你正在改的 YAML。',
        run: async () => { catalog.reload(); startYaml(); },
      });
      return;
    }
    catalog.reload();
    if (catalog.state === 'ready') startYaml();
  }

  function askPublish(
    title: string,
    detail: string,
    run: () => Promise<void>,
  ) {
    setConfirm({ title, detail, run });
  }

  async function publishYaml() {
    if (!catalogGate.allow) {
      setError(catalogGate.reason);
      setYamlPhase('error');
      return;
    }
    const ran = await gate.current.run(async () => {
      setYamlPhase('publishing');
      try {
        const result = await operationsApi.replaceCatalog(yamlDraft, catalogGate.expectedRevision);
        setMessage(`节点目录 r${catalogGate.expectedRevision} → r${result.revision}`);
        setYamlPhase('success');
        setYamlBase(result.revision);
        setYamlBaseText(yamlDraft);
        catalog.reload();
      } catch (err) {
        const text = err instanceof Error ? err.message : '目录没更新成';
        if (/\(409\)|revision|冲突/.test(text)) {
          setError(`${text}。草稿还在，请对照线上版后再发布。`);
          setYamlPhase('conflict');
        } else {
          setError(text);
          setYamlPhase('error');
        }
      }
    });
    if (!ran) return;
  }

  async function publishPolicyJson(next: unknown, draftText: string) {
    if (!policyGate.allow) throw new Error(policyGate.reason);
    const result = await operationsApi.replaceTrafficPolicy(next, policyGate.expectedRevision);
    setMessage(`国内直连规则 r${policyGate.expectedRevision} → r${result.revision}`);
    setPolicyPhase('success');
    setPolicyBase(result.revision);
    setPolicyBaseText(draftText);
    setPolicyDraft(draftText);
    policy.reload();
  }

  async function savePolicyFromDraft() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(policyDraft);
    } catch {
      setError('JSON 无效，没有提交。');
      setPolicyPhase('error');
      return;
    }
    setPolicyPhase('publishing');
    try {
      await gate.current.run(async () => {
        await publishPolicyJson(parsed, policyDraft);
      });
    } catch (err) {
      const text = err instanceof Error ? err.message : '规则没保存成';
      if (/\(409\)/.test(text)) {
        setError(`${text}。草稿还在。`);
        setPolicyPhase('conflict');
      } else {
        setError(text);
        setPolicyPhase('error');
      }
    }
  }

  const lagReady = world.activity.state === 'ready';

  return (
    <div className="stack">
      <DataHealth sources={[
        { label: '节点目录', resource: catalog },
        { label: '直连规则', resource: policy },
        { label: '客户心跳', resource: world.activity },
      ]} />
      <Banner message={error} tone="error" />
      <Banner message={message} tone="ok" />

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
                  disabled={yamlPhase === 'publishing' || yamlDraft === yamlBaseText || !catalogGate.allow}
                  onClick={() => askPublish(
                    '发布节点目录',
                    `基线 r${yamlBase}，线上 r${catalogRevision}，+${yamlDiff?.added ?? 0}/−${yamlDiff?.removed ?? 0}${catalogGate.allow && catalogGate.drifted ? '，已发生 drift' : ''}。发布后客户会拉新目录。`,
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
                  disabled={policyPhase === 'publishing' || policyDraft === policyBaseText}
                  onClick={() => askPublish(
                    '发布直连规则',
                    `基线 r${policyBase}，线上 r${policyRevision}，+${policyDiff?.added ?? 0}/−${policyDiff?.removed ?? 0}。保存后客户端安全重连。`,
                    savePolicyFromDraft,
                  )}
                >对照 diff 保存</button>
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => {
                    let current: { domains?: unknown; mediaEndpoints?: unknown };
                    try { current = JSON.parse(policyDraft) as { domains?: unknown; mediaEndpoints?: unknown }; }
                    catch { setError('当前草稿不是合法 JSON'); return; }
                    const next = { version: 2, domains: current.domains || [], mediaEndpoints: current.mediaEndpoints || [], webDomains: [] };
                    const text = JSON.stringify(next);
                    const diff = lineDiff(policyDraft, text);
                    askPublish(
                      '只停视频网页直连',
                      `将生成新 JSON（+${diff.added}/−${diff.removed}）。微信原生先留着。`,
                      async () => {
                        setPolicyDraft(text);
                        setPolicyPhase('editing-dirty');
                        await publishPolicyJson(next, text);
                      },
                    );
                  }}
                >只停视频网页直连</button>
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => {
                    const next = { version: 1, domains: [], mediaEndpoints: [] };
                    const text = JSON.stringify(next);
                    const diff = lineDiff(policyDraft, text);
                    askPublish(
                      '关闭全部直连',
                      `将生成空规则（+${diff.added}/−${diff.removed}）。客户端会安全重连。`,
                      async () => {
                        setPolicyDraft(text);
                        await publishPolicyJson(next, text);
                      },
                    );
                  }}
                >关掉全部直连</button>
                <button className="btn btn-outline" type="button" onClick={() => { setPolicyBase(null); setPolicyPhase('viewing'); policy.reload(); }}>重新加载</button>
              </div>
            </>
          )}
        </div>
      </GlassCard>

      <Confirm
        open={Boolean(confirm)}
        title={confirm?.title ?? ''}
        detail={confirm?.detail}
        busy={yamlPhase === 'publishing' || policyPhase === 'publishing'}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          setError(null);
          try {
            await confirm.run();
            setConfirm(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : '没做成');
          }
        }}
      />
    </div>
  );
}
