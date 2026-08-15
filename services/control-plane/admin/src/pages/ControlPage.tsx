import { useEffect, useState, type FormEvent } from 'react';
import { operationsApi } from '../api';
import { timestamp } from '../lib/format';
import { useRefresh, useResource } from '../hooks';
import { Banner, StateBoundary } from '../ui';

export function ControlPage() {
  const { refreshMs } = useRefresh();
  const catalog = useResource(operationsApi.exitCatalog, [], refreshMs);
  const policy = useResource(operationsApi.trafficPolicy, [], refreshMs);
  const [yaml, setYaml] = useState('');
  const [policyText, setPolicyText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (policy.state === 'ready') {
      try {
        setPolicyText(JSON.stringify(JSON.parse(policy.data.json), null, 2));
      } catch {
        setPolicyText(policy.data.json);
      }
    }
  }, [policy.state, policy.state === 'ready' ? policy.data.json : '']);

  async function replaceCatalog(event: FormEvent) {
    event.preventDefault();
    if (!yaml.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const expected = catalog.state === 'ready' ? catalog.data.revision : 0;
      const result = await operationsApi.replaceCatalog(yaml, expected);
      setMessage(`节点目录已更新到版本 ${result.revision}`);
      setYaml('');
      catalog.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '替换目录失败');
    } finally {
      setBusy(false);
    }
  }

  async function publishPolicy(next: unknown) {
    const expected = policy.state === 'ready' ? policy.data.revision : 0;
    const result = await operationsApi.replaceTrafficPolicy(next, expected);
    setMessage(`精确直连策略已更新到版本 ${result.revision}`);
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
      setError(err instanceof Error ? err.message : '保存策略失败');
    } finally {
      setBusy(false);
    }
  }

  return <div className="stack">
    <Banner message={error} tone="error" />
    <Banner message={message} tone="ok" />

    <section className="card">
      <div className="card-header">
        <div>
          <h2>云端节点目录</h2>
          <p>
            {catalog.state === 'ready' && catalog.data.revision > 0
              ? `当前版本 ${catalog.data.revision} · ${timestamp(catalog.data.updatedAt)}`
              : '尚未上传云端节点目录'}
          </p>
        </div>
      </div>
      <div className="card-body">
        <form className="stack" onSubmit={replaceCatalog}>
          <label>
            <span className="muted">从本机载入完整 Clash YAML</span>
            <input
              className="input"
              type="file"
              accept=".yaml,.yml,application/yaml,text/yaml,text/plain"
              disabled={busy}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size < 11 || file.size > 1024 * 1024) {
                  setError('目录文件必须为 11 bytes–1 MiB');
                  event.target.value = '';
                  return;
                }
                setYaml(await file.text());
                setMessage('目录已在本机载入；确认后再替换云端版本。');
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
            onChange={(event) => setYaml(event.target.value)}
            disabled={busy}
          />
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy || !yaml.trim()}>替换云端节点目录</button>
          </div>
        </form>
      </div>
    </section>

    <section className="card">
      <div className="card-header">
        <div>
          <h2>精确直连策略</h2>
          <p>
            {policy.state === 'ready' && policy.data.revision > 0
              ? `当前版本 ${policy.data.revision} · ${timestamp(policy.data.updatedAt)}`
              : '尚未启用国内精确直连'}
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
            <button className="btn" type="submit" disabled={busy || policy.state !== 'ready'}>替换精确直连策略</button>
            <button
              className="btn btn-outline"
              type="button"
              disabled={busy || policy.state !== 'ready'}
              onClick={async () => {
                if (!confirm('只停止视频网页直连，保留原生微信试验？')) return;
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
                if (!confirm('立即停止全部国内精确直连并让客户端安全重连？')) return;
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
            >立即停止全部直连</button>
          </div>
        </form>
      </div>
    </section>
  </div>;
}
