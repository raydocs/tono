import { useEffect, useState, type FormEvent } from 'react';
import { operationsApi } from '../api';
import { timestamp } from '../lib/format';
import { publishGate } from '../lib/revision';
import { useRefresh, useResource } from '../hooks';
import { Banner, DataHealth, StateBoundary } from '../ui';

export function ControlPage() {
  const { refreshMs } = useRefresh();
  const catalog = useResource(operationsApi.exitCatalog, [], refreshMs);
  const policy = useResource(operationsApi.trafficPolicy, [], refreshMs);
  const [yaml, setYaml] = useState('');
  // The revision this draft was written against, frozen when the draft appears.
  //
  // `expectedRevision` is the server's compare-and-swap: publish only if the
  // catalog is still what I looked at. Reading it live off an auto-refreshing
  // resource made it always agree with the server by construction, so the check
  // could never fire from this page. Someone else publishing r37 while a draft
  // built on r36 sat in the box meant that draft went out as r38 and r37
  // vanished with no error anywhere. Frozen, the server answers 409 — which is
  // the whole point of sending the field.
  const [yamlBase, setYamlBase] = useState<number | null>(null);
  const [policyText, setPolicyText] = useState('');
  const [policyBase, setPolicyBase] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const catalogRevision = catalog.state === 'ready' ? catalog.data.revision : null;
  const policyRevision = policy.state === 'ready' ? policy.data.revision : null;
  const catalogGate = publishGate(yamlBase, catalogRevision);
  const policyGate = publishGate(policyBase, policyRevision);
  const catalogDrifted = catalogGate.allow && catalogGate.drifted;
  const policyDrifted = policyGate.allow && policyGate.drifted;

  // Seeded once, then left alone. This effect used to re-run whenever the
  // served policy changed, which — with the page refreshing on a timer —
  // replaced whatever the operator had typed with the server's copy, without
  // saying so. Re-seeding is now something you ask for.
  useEffect(() => {
    if (policy.state !== 'ready' || policyBase !== null) return;
    try {
      setPolicyText(JSON.stringify(JSON.parse(policy.data.json), null, 2));
    } catch {
      setPolicyText(policy.data.json);
    }
    setPolicyBase(policy.data.revision);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy.state, policyBase, policy.state === 'ready' ? policy.data.json : '']);

  function editYaml(text: string) {
    setYaml(text);
    if (!text.trim()) setYamlBase(null);
    else if (yamlBase === null && catalogRevision !== null) setYamlBase(catalogRevision);
  }

  async function replaceCatalog(event: FormEvent) {
    event.preventDefault();
    if (!yaml.trim()) return;
    if (!catalogGate.allow) {
      setError(catalogGate.reason);
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await operationsApi.replaceCatalog(yaml, catalogGate.expectedRevision);
      setMessage(`节点目录已更新到第 ${result.revision} 版`);
      setYaml('');
      setYamlBase(null);
      catalog.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '目录没更新成');
    } finally {
      setBusy(false);
    }
  }

  async function publishPolicy(next: unknown) {
    if (!policyGate.allow) throw new Error(policyGate.reason);
    const result = await operationsApi.replaceTrafficPolicy(next, policyGate.expectedRevision);
    setMessage(`国内直连规则已更新到第 ${result.revision} 版`);
    setPolicyBase(null);
    policy.reload();
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await publishPolicy(JSON.parse(policyText));
    } catch (err) {
      setError(err instanceof Error ? err.message : '规则没保存成');
    } finally {
      setBusy(false);
    }
  }

  return <div className="stack">
    <DataHealth sources={[
      { label: '节点目录', resource: catalog },
      { label: '直连规则', resource: policy },
    ]} />
    <Banner message={error} tone="error" />
    <Banner message={message} tone="ok" />
    <Banner
      tone="error"
      message={catalogDrifted
        ? `线上目录已经是第 ${catalogRevision} 版，你这份是按第 ${yamlBase} 版改的。现在提交会被拒。先把第 ${catalogRevision} 版拉下来，再把你的改动合进去。`
        : null}
    />
    <Banner
      tone="error"
      message={policyDrifted
        ? `线上规则已经是第 ${policyRevision} 版，编辑框里的是第 ${policyBase} 版。保存会被拒。点「重新加载」拿回最新版，你现在改的会丢掉。`
        : null}
    />

    <section className="card">
      <div className="card-header">
        <div>
          <h2>节点目录</h2>
          <p>
            {catalog.state === 'ready' && catalog.data.revision > 0
              ? `当前第 ${catalog.data.revision} 版 · ${timestamp(catalog.data.updatedAt)}`
              : '还没有上传节点目录'}
          </p>
        </div>
      </div>
      <div className="card-body">
        <form className="stack" onSubmit={replaceCatalog}>
          <label>
            <span className="muted">从电脑选择 Clash YAML</span>
            <input
              className="input"
              type="file"
              accept=".yaml,.yml,application/yaml,text/yaml,text/plain"
              disabled={busy}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size < 11 || file.size > 1024 * 1024) {
                  setError('文件要在 11 字节到 1 MB 之间');
                  event.target.value = '';
                  return;
                }
                editYaml(await file.text());
                setMessage('文件已读入，确认无误后再提交。');
              }}
            />
          </label>
          <textarea
            className="input control-textarea"
            rows={12}
            spellCheck={false}
            autoComplete="off"
            placeholder={'proxies:\n  - name: ...'}
            value={yaml}
            onChange={(event) => editYaml(event.target.value)}
            disabled={busy}
          />
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy || !yaml.trim()}>更新节点目录</button>
          </div>
        </form>
      </div>
    </section>

    <section className="card">
      <div className="card-header">
        <div>
          <h2>国内直连规则</h2>
          <p>
            {policy.state === 'ready' && policy.data.revision > 0
              ? `当前第 ${policy.data.revision} 版 · ${timestamp(policy.data.updatedAt)}`
              : '还没开国内直连'}
          </p>
        </div>
      </div>
      <div className="card-body">
        <form className="stack" onSubmit={savePolicy}>
          <textarea
            className="input control-textarea"
            rows={14}
            spellCheck={false}
            autoComplete="off"
            value={policyText}
            onChange={(event) => setPolicyText(event.target.value)}
            disabled={busy || policy.state !== 'ready'}
          />
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy || policy.state !== 'ready'}>保存规则</button>
            <button
              className="btn btn-outline"
              type="button"
              disabled={busy || policy.state !== 'ready'}
              onClick={() => { setPolicyBase(null); policy.reload(); }}
            >重新加载</button>
            <button
              className="btn btn-outline"
              type="button"
              disabled={busy || policy.state !== 'ready'}
              onClick={async () => {
                if (!confirm('只关掉视频网页直连，微信原生先留着？')) return;
                setBusy(true);
                setError(null);
                try {
                  const current = JSON.parse(policyText) as { domains?: unknown; mediaEndpoints?: unknown };
                  await publishPolicy({
                    version: 2,
                    domains: current.domains || [],
                    mediaEndpoints: current.mediaEndpoints || [],
                    webDomains: [],
                  });
                } catch (err) {
                  setError(err instanceof Error ? err.message : '更新失败');
                } finally {
                  setBusy(false);
                }
              }}
            >只停视频网页直连</button>
            <button
              className="btn btn-outline"
              type="button"
              disabled={busy || policy.state !== 'ready'}
              onClick={async () => {
                if (!confirm('马上关掉全部国内直连？客户端会安全重连。')) return;
                setBusy(true);
                setError(null);
                try {
                  await publishPolicy({ version: 1, domains: [], mediaEndpoints: [] });
                } catch (err) {
                  setError(err instanceof Error ? err.message : '更新失败');
                } finally {
                  setBusy(false);
                }
              }}
            >关掉全部直连</button>
          </div>
        </form>
      </div>
    </section>
  </div>;
}
