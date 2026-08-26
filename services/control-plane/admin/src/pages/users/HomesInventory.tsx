import { useState, type FormEvent } from 'react';
import { operationsApi, type HomeExitDto } from '../../api';
import { timeAgo, timestamp } from '../../lib/format';
import type { Live } from '../../hooks';
import { Banner, Empty, Skeleton, Status, Unavailable } from '../../ui';
import { usePrivacy } from '../../privacy';
import { useAsk } from './ask';

export function HomesInventory({ homes }: { homes: Live<HomeExitDto[]> }) {
  const privacy = usePrivacy();
  const ask = useAsk();
  const [importText, setImportText] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [proxyName, setProxyName] = useState('');
  const [kind, setKind] = useState<'catalog' | 'socks5'>('socks5');
  const [socks5Host, setSocks5Host] = useState('');
  const [socks5Port, setSocks5Port] = useState('');
  const [socks5Username, setSocks5Username] = useState('');
  const [socks5Password, setSocks5Password] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function importLines(event: FormEvent) {
    event.preventDefault();
    const lines = importText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      setError('先贴一行或多行 host:port:user:pass');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await operationsApi.importHomeLines(lines);
      setMessage([
        result.created.length ? `加了 ${result.created.length} 条` : null,
        result.skipped.length ? `跳过 ${result.skipped.length} 条` : null,
        result.failed.length ? `失败 ${result.failed.length} 条` : null,
      ].filter(Boolean).join(' · ') || '没有新的线路');
      if (result.created.length) setImportText('');
      homes.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入库存失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {ask.dialog}
      <Banner message={error} tone="error" />
      <Banner message={message} tone="ok" />
      <section className="card">
        <div className="card-header">
          <div>
            <h2>批量加家宽</h2>
            <p>每行 <code>host:port:user:pass</code>，也可以是 <code>user:pass@host:port</code> 或 <code>socks5://…</code>。</p>
          </div>
        </div>
        <div className="card-body">
          <form className="stack" onSubmit={importLines}>
            <textarea className="input control-textarea" rows={4} spellCheck={false} value={importText} onChange={(event) => setImportText(event.target.value)} disabled={busy} />
            <button className="btn" type="submit" disabled={busy || !importText.trim()}>加入库存</button>
          </form>
        </div>
      </section>
      <details className="card extras-fold">
        <summary className="extras-summary">手动登记线路</summary>
        <form
          className="card-body form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            operationsApi.createHomeExit({
              proxyName: proxyName.trim(),
              displayName: displayName.trim(),
              kind,
              ...(kind === 'socks5' ? {
                socks5Host: socks5Host.trim(),
                socks5Port: Number(socks5Port),
                socks5Username,
                socks5Password,
              } : {}),
            }).then((created) => {
              setMessage(`已加上 ${created.displayName}`);
              homes.reload();
            }).catch((err) => setError(err instanceof Error ? err.message : '创建失败'))
              .finally(() => setBusy(false));
          }}
        >
          <input className="input" required placeholder="名称" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          <input className="input" required placeholder="节点名" value={proxyName} onChange={(event) => setProxyName(event.target.value)} />
          <select className="input" value={kind} onChange={(event) => setKind(event.target.value as 'catalog' | 'socks5')}>
            <option value="catalog">目录里的节点</option>
            <option value="socks5">SOCKS5 家宽</option>
          </select>
          {kind === 'socks5' && (
            <>
              <input className="input" required placeholder="主机" value={socks5Host} onChange={(event) => setSocks5Host(event.target.value)} />
              <input className="input" required type="number" placeholder="端口" value={socks5Port} onChange={(event) => setSocks5Port(event.target.value)} />
              <input className="input" required placeholder="用户名" value={socks5Username} onChange={(event) => setSocks5Username(event.target.value)} />
              <input className="input" required type="password" placeholder="密码" value={socks5Password} onChange={(event) => setSocks5Password(event.target.value)} />
            </>
          )}
          <button className="btn" type="submit" disabled={busy}>加上</button>
        </form>
      </details>
      <section className="card">
        <div className="card-header">
          <div><h2>家宽库存</h2><p>启用后才能绑给客户。</p></div>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => homes.reload()}>刷新</button>
        </div>
        <div className="card-body homes-list">
          {homes.state === 'loading' && <Skeleton />}
          {homes.state === 'error' && <Unavailable title="库存没加载上来" detail={homes.message} />}
          {homes.state === 'ready' && homes.data.length === 0 && <Empty title="库存是空的" />}
          {homes.state === 'ready' && homes.data.map((home) => (
            <article key={home.id} className="card home-card">
              <strong>{home.displayName}</strong>
              <span className="mono">{home.kind === 'socks5' ? `${privacy.ip(home.socks5Host)}:${home.socks5Port}` : privacy.ip(home.egressIpv4)}</span>
              <Status value={home.status} />
              <small className="muted">{home.probeStatus ? `${home.probeStatus} · ${home.lastProbedAt ? timeAgo(home.lastProbedAt) : ''}` : '未检测'} · {timestamp(home.updatedAt)}</small>
              <div className="row-actions">
                {home.status !== 'active'
                  ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => operationsApi.updateHomeExit(home.id, { status: 'active' }).then(() => homes.reload())}>启用</button>
                  : <button type="button" className="btn btn-ghost btn-sm" onClick={() => operationsApi.updateHomeExit(home.id, { status: 'disabled' }).then(() => homes.reload())}>停用</button>}
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => ask.prompt(
                    `删除家宽「${home.displayName}」？`,
                    '要先把绑着的客户都解开。确认后才会从库存去掉。',
                    () => operationsApi.deleteHomeExit(home.id).then(() => homes.reload()),
                  )}
                >删除</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
