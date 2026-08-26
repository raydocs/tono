import { useState, type FormEvent } from 'react';
import { operationsApi, type HomeExitDto } from '../../api';
import { tcpPort } from '../../lib/fields';
import { timeAgo, timestamp } from '../../lib/format';
import type { Live } from '../../hooks';
import { Banner, Empty, Field, FieldGrid, Skeleton, Status, Unavailable } from '../../ui';
import { usePrivacy } from '../../privacy';
import { useAsk } from './ask';
import { useMutation } from './mutate';

export function HomesInventory({ homes }: { homes: Live<HomeExitDto[]> }) {
  const privacy = usePrivacy();
  const ask = useAsk();
  const mutate = useMutation();
  const [importText, setImportText] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [proxyName, setProxyName] = useState('');
  const [kind, setKind] = useState<'catalog' | 'socks5'>('socks5');
  const [socks5Host, setSocks5Host] = useState('');
  const [socks5Port, setSocks5Port] = useState('');
  const [socks5Username, setSocks5Username] = useState('');
  const [socks5Password, setSocks5Password] = useState('');
  const [egressIpv4, setEgressIpv4] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  function clearCreate() {
    setDisplayName('');
    setProxyName('');
    setSocks5Host('');
    setSocks5Port('');
    setSocks5Username('');
    setSocks5Password('');
    setEgressIpv4('');
    setNotes('');
  }

  async function importLines(event: FormEvent) {
    event.preventDefault();
    const lines = importText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      setError('先贴一行或多行 host:port:user:pass');
      return;
    }
    setError(null);
    await mutate.run(async () => {
      const result = await operationsApi.importHomeLines(lines);
      const failed = [
        ...result.skipped.map((row) => `跳过 ${privacy.ip(row.host)}:${row.port ?? ''} ${row.message}`),
        ...result.failed.map((row) => row.message),
      ];
      mutate.setOk([
        result.created.length ? `加了 ${result.created.length} 条` : null,
        result.skipped.length ? `跳过 ${result.skipped.length} 条` : null,
        result.failed.length ? `失败 ${result.failed.length} 条` : null,
      ].filter(Boolean).join(' · ') || '没有新的线路');
      if (failed.length) setError(failed.join('；'));
      if (result.created.length) setImportText('');
      homes.reload();
    });
  }

  return (
    <div className="stack">
      {ask.dialog}
      <Banner message={error || mutate.error} tone="error" />
      <Banner message={mutate.ok} tone="ok" />
      <section className="card">
        <div className="card-header">
          <div>
            <h2>批量加家宽</h2>
            <p>每行 <code>host:port:user:pass</code>，也可以是 <code>user:pass@host:port</code> 或 <code>socks5://…</code>。</p>
          </div>
        </div>
        <div className="card-body">
          <form className="stack" onSubmit={(event) => void importLines(event)}>
            <textarea className="input control-textarea sensitive-value" aria-label="家宽线路，每行一条" rows={4} spellCheck={false} value={importText} onChange={(event) => setImportText(event.target.value)} disabled={mutate.busy} />
            <button className="btn" type="submit" disabled={mutate.busy || !importText.trim()}>加入库存</button>
          </form>
        </div>
      </section>
      <details className="card extras-fold">
        <summary className="extras-summary">手动登记线路</summary>
        <form
          className="card-body form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            const port = kind === 'socks5' ? tcpPort(socks5Port) : null;
            if (kind === 'socks5' && (port === 'invalid' || port == null)) {
              setError('端口必须是 1–65535。');
              return;
            }
            setError(null);
            void mutate.run(async () => {
              const created = await operationsApi.createHomeExit({
                proxyName: proxyName.trim(),
                displayName: displayName.trim(),
                kind,
                notes: notes.trim() || undefined,
                egressIpv4: egressIpv4.trim() || undefined,
                ...(kind === 'socks5' ? {
                  socks5Host: socks5Host.trim(),
                  socks5Port: port as number,
                  socks5Username,
                  socks5Password,
                } : {}),
              });
              mutate.setOk(`已加上 ${created.displayName}`);
              clearCreate();
              homes.reload();
            });
          }}
        >
          <FieldGrid>
            <Field label="名称">
              <input className="input" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </Field>
            <Field label="节点名">
              <input className="input" required value={proxyName} onChange={(event) => setProxyName(event.target.value)} />
            </Field>
            <Field label="类型">
              <select className="input" value={kind} onChange={(event) => setKind(event.target.value as 'catalog' | 'socks5')}>
                <option value="catalog">目录里的节点</option>
                <option value="socks5">SOCKS5 家宽</option>
              </select>
            </Field>
            <Field label="出口 IPv4" hint="可选">
              <input className="input sensitive-value" value={egressIpv4} onChange={(event) => setEgressIpv4(event.target.value)} />
            </Field>
            <Field label="备注" hint="可选">
              <input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
            {kind === 'socks5' && (
              <>
                <Field label="主机">
                  <input className="input sensitive-value" required value={socks5Host} onChange={(event) => setSocks5Host(event.target.value)} />
                </Field>
                <Field label="端口" hint="1–65535">
                  <input className="input" required type="number" min={1} max={65535} value={socks5Port} onChange={(event) => setSocks5Port(event.target.value)} />
                </Field>
                <Field label="用户名">
                  <input className="input sensitive-value" required value={socks5Username} onChange={(event) => setSocks5Username(event.target.value)} />
                </Field>
                <Field label="密码">
                  <input className="input" required type="password" value={socks5Password} onChange={(event) => setSocks5Password(event.target.value)} />
                </Field>
              </>
            )}
          </FieldGrid>
          <div className="row-actions"><button className="btn" type="submit" disabled={mutate.busy}>加上</button></div>
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
              <div className="home-card-top">
                <strong>{home.displayName}</strong>
                <Status value={home.status} />
                <span className={`chip ${(home.bindCount ?? 0) > 0 ? 'chip-ok' : 'chip-unknown'}`}>
                  {(home.bindCount ?? 0) > 0 ? `绑定 ${home.bindCount} 人` : '闲置'}
                </span>
              </div>
              <div className="home-card-meta">
                <span className="mono">{home.kind === 'socks5' ? `${privacy.ip(home.socks5Host)}:${home.socks5Port}` : privacy.ip(home.egressIpv4)}</span>
                <span>{home.proxyName} · {home.kind}</span>
                <span>
                  探测 {home.probeStatus || '未检测'}
                  {home.probeUptimeRatio != null ? ` · 在线率 ${Math.round(home.probeUptimeRatio * 100)}%` : ''}
                  {home.lastProbedAt ? ` · ${timeAgo(home.lastProbedAt)}` : ''}
                </span>
                {home.notes ? <span>{home.notes}</span> : null}
                <span>更新 {timestamp(home.updatedAt)}</span>
              </div>
              <div className="row-actions">
                {home.status !== 'active'
                  ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={mutate.busy}
                      onClick={() => void mutate.run(async () => { await operationsApi.updateHomeExit(home.id, { status: 'active' }); homes.reload(); }, '已启用')}
                    >启用</button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={mutate.busy}
                      onClick={() => void mutate.run(async () => { await operationsApi.updateHomeExit(home.id, { status: 'disabled' }); homes.reload(); }, '已停用')}
                    >停用</button>
                  )}
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={mutate.busy}
                  onClick={() => ask.prompt(
                    `删除家宽「${home.displayName}」？`,
                    '要先把绑着的客户都解开。确认后才会从库存去掉。',
                    async () => { await operationsApi.deleteHomeExit(home.id); homes.reload(); },
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
