import { useMemo, useState, Fragment, type FormEvent } from 'react';
import {
  operationsApi,
  type ActivityDto,
  type HomeExitDto,
  type ProductAccountDto,
  type UserDetailDto,
  type UserDto,
} from '../api';
import { catalogProxyNames } from '../lib/catalog';
import { formatBytes, timeAgo, timestamp } from '../lib/format';
import { formatExitDelay, formatTcpDelay, nodeHealthLabel, nodeHealthTone } from '../lib/path-status';
import { useRefresh, useResource } from '../hooks';
import { Banner, DataHealth, StateBoundary, Status } from '../ui';

type OnboardResult = {
  email: string;
  allowlisted: boolean;
  registered: boolean;
  exitIdentityIssued: boolean;
  hasHome: boolean;
  hasClaude: boolean;
  extrasIgnored: boolean;
};

function OnboardChecklist({ result }: { result: OnboardResult }) {
  const rows: Array<{ ok: boolean; text: string }> = [
    { ok: result.allowlisted, text: '可以用这个邮箱登录' },
    {
      ok: result.registered,
      text: result.registered
        ? '已经在 App 里注册过'
        : '还没注册，用这个邮箱在 App 里收验证码就行',
    },
    {
      ok: result.exitIdentityIssued,
      text: result.exitIdentityIssued
        ? '连接凭证已生成。还要同步到服务器，同步停了就连不上'
        : '连接凭证还没生成，等客户登录后再点一次保存',
    },
    {
      ok: result.hasHome,
      text: result.hasHome ? '已绑定家宽' : '还没绑定家宽（可选）',
    },
    {
      ok: result.hasClaude,
      text: result.hasClaude ? '已开通 Claude' : '还没开通 Claude（可选）',
    },
  ];
  if (result.extrasIgnored) {
    rows.push({
      ok: false,
      text: '这次填的家宽和 Claude 没保存，等客户登录后再点一次',
    });
  }
  return (
    <ul className="onboard-check">
      {rows.map((row) => (
        <li key={row.text} className={row.ok ? 'ok' : 'wait'}>
          <span aria-hidden>{row.ok ? '✓' : '○'}</span>
          {row.text}
        </li>
      ))}
    </ul>
  );
}

function OnboardCard({ unusedHomes, pooledAccounts, onDone }: {
  unusedHomes: HomeExitDto[];
  pooledAccounts: ProductAccountDto[];
  onDone: () => void;
}) {
  const [email, setEmail] = useState('');
  const [line, setLine] = useState('');
  const [homeExitId, setHomeExitId] = useState('');
  const [accountRef, setAccountRef] = useState('');
  const [productAccountId, setProductAccountId] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OnboardResult | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await operationsApi.onboardUser({
        email: email.trim(),
        line: line.trim() || undefined,
        homeExitId: homeExitId || undefined,
        accountRef: accountRef.trim() || undefined,
        productAccountId: productAccountId || undefined,
        contact: contact.trim() || undefined,
      });
      const extrasOffered = Boolean(
        line.trim() || homeExitId || accountRef.trim() || productAccountId || contact.trim(),
      );
      const next: OnboardResult = {
        email: response.email,
        allowlisted: response.allowlisted,
        registered: response.userId != null,
        exitIdentityIssued: Boolean(response.exitIdentityIssued),
        hasHome: response.binding != null,
        hasClaude: response.account != null,
        extrasIgnored: extrasOffered && response.userId == null,
      };
      setResult(next);
      if (next.registered && next.exitIdentityIssued) {
        setLine('');
        setHomeExitId('');
        setAccountRef('');
        setProductAccountId('');
        setContact('');
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>开通客户</h2>
          <p>
            先让客户能登录。已经注册过的，点保存会生成连接凭证。
            家宽和 Claude 可以一起填，也可以以后再绑。
          </p>
        </div>
      </div>
      <div className="card-body">
        <Banner message={error} tone="error" />
        <form className="onboard-form" onSubmit={submit}>
          <label className="onboard-email">
            <span>客户邮箱</span>
            <input
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="用来收验证码的邮箱"
              disabled={busy}
            />
          </label>
          <button className="btn" type="submit" disabled={busy || !email.trim()}>
            {busy ? '保存中…' : '保存'}
          </button>
          <details className="onboard-more">
            <summary>已经登录的，可以顺便绑定家宽、开通 Claude</summary>
            <div className="form-grid">
              <label>
                <span>家宽（直接贴过来）</span>
                <input className="input" value={line} onChange={(e) => setLine(e.target.value)} placeholder="host:port:user:pass" disabled={busy} spellCheck={false} autoComplete="off" />
              </label>
              <label>
                <span>或从库存里选</span>
                <select className="input" value={homeExitId} onChange={(e) => setHomeExitId(e.target.value)} disabled={busy || unusedHomes.length === 0}>
                  <option value="">{unusedHomes.length ? '先不选' : '库存是空的'}</option>
                  {unusedHomes.map((home) => (
                    <option key={home.id} value={home.id}>{home.displayName} · {home.socks5Host}:{home.socks5Port}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Claude 账号</span>
                <input className="input" value={accountRef} onChange={(e) => setAccountRef(e.target.value)} placeholder="账号" disabled={busy} />
              </label>
              <label>
                <span>或从号池里选</span>
                <select className="input" value={productAccountId} onChange={(e) => setProductAccountId(e.target.value)} disabled={busy || pooledAccounts.length === 0}>
                  <option value="">{pooledAccounts.length ? '先不选' : '号池是空的'}</option>
                  {pooledAccounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.accountRef}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>微信或备注</span>
                <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} disabled={busy} />
              </label>
            </div>
          </details>
        </form>
        {result && (
          <div className="onboard-result">
            <strong>{result.email}</strong>
            <OnboardChecklist result={result} />
          </div>
        )}
      </div>
    </section>
  );
}

export function UsersPage() {
  const { refreshMs } = useRefresh();
  const users = useResource(operationsApi.users, [], refreshMs);
  const activity = useResource<ActivityDto>(operationsApi.activity, [], refreshMs);
  const allowlist = useResource(operationsApi.signupAllowlist, [], refreshMs);
  const homes = useResource(operationsApi.homeExits, [], refreshMs);
  const catalog = useResource(operationsApi.exitCatalog, [], refreshMs);
  const pooled = useResource(() => operationsApi.productAccounts('pooled'), [], refreshMs);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bindPick, setBindPick] = useState<Record<string, string>>({});
  const [defaultPick, setDefaultPick] = useState<Record<string, string>>({});
  const [assignLine, setAssignLine] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expiryPick, setExpiryPick] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [onlyMissingExit, setOnlyMissingExit] = useState(false);
  const [showAllowlist, setShowAllowlist] = useState(false);

  const reloadAll = () => {
    users.reload();
    allowlist.reload();
    homes.reload();
    catalog.reload();
    pooled.reload();
    activity.reload();
  };

  async function removeAllow(address: string) {
    if (!confirm(`取消 ${address} 的注册资格？已经注册的账号不会被关掉。`)) return;
    setBusy(true);
    setError(null);
    try {
      await operationsApi.removeSignupEmail(address);
      setMessage(`已撤销 ${address}`);
      allowlist.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '撤销失败');
    } finally {
      setBusy(false);
    }
  }

  async function toggleUser(user: UserDto) {
    if (user.status === 'active') {
      if (!confirm(`要注销 ${user.email} 吗？马上不能登录，设备会撤销，家宽会退回库存。`)) return;
    } else if (!confirm(`恢复 ${user.email} 的账号？`)) return;
    setBusy(true);
    setError(null);
    try {
      if (user.status === 'active') {
        await operationsApi.closeUser(user.id);
        setMessage(`已注销 ${user.email}`);
      } else {
        await operationsApi.setUserStatus(user.id, 'active');
        setMessage(`已恢复 ${user.email}`);
      }
      users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '没改成');
    } finally {
      setBusy(false);
    }
  }

  async function setExpiry(user: UserDto, expiresAt: number | null) {
    setBusy(true);
    setError(null);
    try {
      await operationsApi.setUserExpiry(user.id, expiresAt);
      setMessage(expiresAt === null
        ? `已取消 ${user.email} 的到期限制`
        : `${user.email} 将于 ${timestamp(expiresAt)} 到期`);
      users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '到期时间没改成');
    } finally {
      setBusy(false);
    }
  }

  // The dashboard raises 已超配额 from this same list, and a suspended customer
  // cannot connect until a cycle ends. Until now the only way to end one was a
  // hand-written call to the token-admin API.
  //
  // Not a zeroing. The collector re-sends a fleet-wide cumulative total every
  // ten minutes and the control plane keeps `MAX()` of what it has seen, so
  // usage that was merely set to 0 comes back within ten minutes. The server
  // moves the baseline up to the reported counter instead, which is why this
  // sends `resetUsage` rather than a number.
  async function resetUsage(user: UserDto) {
    if (!confirm(
      `要把 ${user.email} 这期流量清零吗？\n\n`
      + `现在的 ${formatBytes(user.usageBytes)} 算已经结过，从现在重新算。`
      + `服务器上的历史累计不会删，也撤不回。`,
    )) return;
    setBusy(true);
    setError(null);
    try {
      await operationsApi.resetUserUsage(user.id);
      setMessage(`${user.email} 这期流量已清零`);
      users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '这期没清掉');
    } finally {
      setBusy(false);
    }
  }

  async function applyExpiryPick(user: UserDto) {
    const value = expiryPick[user.id];
    if (!value) {
      setError('先选到期时间');
      return;
    }
    const seconds = Math.floor(new Date(value).getTime() / 1_000);
    if (!Number.isSafeInteger(seconds) || seconds <= 0) {
      setError('到期时间无效');
      return;
    }
    await setExpiry(user, seconds);
  }

  async function bindHome(user: UserDto) {
    const homeExitId = bindPick[user.id] || user.homeBinding?.homeExitId;
    if (!homeExitId) {
      setError('先选一条家宽');
      return;
    }
    const defaultProxyName = defaultPick[user.id] ?? user.homeBinding?.defaultProxyName ?? '';
    setBusy(true);
    setError(null);
    try {
      const binding = await operationsApi.bindUserHome(user.id, {
        homeExitId,
        defaultProxyName: defaultProxyName || null,
      });
      setMessage(binding.defaultProxyName
        ? `已给 ${user.email} 绑上 ${binding.displayName}，默认走 ${binding.defaultProxyName}`
        : `已给 ${user.email} 绑上 ${binding.displayName}`);
      users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '绑定失败');
    } finally {
      setBusy(false);
    }
  }

  async function assignPasted(user: UserDto) {
    const line = (assignLine[user.id] ?? '').trim();
    if (!line) {
      setError('先把线路贴进来');
      return;
    }
    if (user.homeBinding && !confirm(`要给 ${user.email} 换家宽吗？没人用的旧线路会停掉。`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await operationsApi.assignHomeLine({
        userId: user.id,
        line,
        defaultProxyName: defaultPick[user.id] ?? user.homeBinding?.defaultProxyName ?? null,
        replace: Boolean(user.homeBinding),
      });
      setMessage(result.replaced
        ? `已给 ${user.email} 换成 ${result.homeExit.displayName}`
        : `已给 ${user.email} 绑上 ${result.homeExit.displayName}`);
      setAssignLine((prev) => ({ ...prev, [user.id]: '' }));
      reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : '没绑上');
    } finally {
      setBusy(false);
    }
  }

  async function unbindHome(user: UserDto) {
    if (!confirm(`要解开 ${user.email} 的家宽吗？`)) return;
    setBusy(true);
    setError(null);
    try {
      await operationsApi.unbindUserHome(user.id);
      setMessage(`已解开 ${user.email} 的家宽`);
      users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '解绑失败');
    } finally {
      setBusy(false);
    }
  }

  const activeHomes = useMemo(
    () => (homes.state === 'ready' ? homes.data.filter((h) => h.status === 'active') : []),
    [homes],
  );
  const unusedHomes = useMemo(
    () => activeHomes.filter((home) => home.kind === 'socks5' && (home.bindCount ?? 0) === 0),
    [activeHomes],
  );

  // Shared VPS nodes = catalog proxies minus every registered home exit proxyName.
  const sharedProxies = useMemo(() => {
    if (catalog.state !== 'ready') return [];
    const homeNames = new Set((homes.state === 'ready' ? homes.data : []).map((h) => h.proxyName));
    return catalogProxyNames(catalog.data.yaml).filter((name) => !homeNames.has(name));
  }, [catalog, homes]);

  return <div className="stack">
    <DataHealth sources={[
      { label: '客户', resource: users },
      { label: '可注册邮箱', resource: allowlist },
      { label: '家宽库存', resource: homes },
      { label: '节点目录', resource: catalog },
      { label: 'Claude 号池', resource: pooled },
      { label: '客户心跳', resource: activity },
    ]} />
    <Banner message={error} tone="error" />
    <Banner message={message} tone="ok" />

    <OnboardCard
      unusedHomes={unusedHomes}
      pooledAccounts={pooled.state === 'ready' ? pooled.data : []}
      onDone={reloadAll}
    />

    {allowlist.state === 'ready' && allowlist.data.length > 0 && (
      <div className="fold-bar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAllowlist((value) => !value)}>
          {showAllowlist ? '收起可注册邮箱' : `还有 ${allowlist.data.length} 个邮箱可以注册`}
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={reloadAll} disabled={busy}>刷新</button>
      </div>
    )}
    {showAllowlist && allowlist.state === 'ready' && (
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>邮箱</th><th>加入时间</th><th></th></tr></thead>
            <tbody>
              {allowlist.data.map((entry) => (
                <tr key={entry.email}>
                  <td><strong>{entry.email}</strong></td>
                  <td className="muted">{timestamp(entry.createdAt)}</td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => removeAllow(entry.email)}>撤销</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )}

    <section className="card">
      <div className="card-header">
        <div>
          <h2>客户</h2>
          <p>点一行可以展开。日常换线路，把地址贴到右边即可。</p>
        </div>
        <div className="form-row">
          <input
            className="input compact"
            type="search"
            placeholder="搜索邮箱 / 家宽 / Claude"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="filter-check">
            <input type="checkbox" checked={onlyIncomplete} onChange={(e) => setOnlyIncomplete(e.target.checked)} />
            只看没开 Claude 的
          </label>
          <label className="filter-check">
            <input type="checkbox" checked={onlyMissingExit} onChange={(e) => setOnlyMissingExit(e.target.checked)} />
            只看没有凭证的
          </label>
          <button type="button" className="btn btn-outline btn-sm" onClick={reloadAll} disabled={busy}>刷新</button>
        </div>
      </div>
      <div className="table-wrap">
        <StateBoundary resource={users} empty={(rows: UserDto[]) => rows.length === 0}>
          {(rows) => {
            const needle = query.trim().toLowerCase();
            const visible = rows.filter((user) => {
              if (onlyIncomplete && !user.product?.incomplete) return false;
              if (onlyMissingExit && user.hasExitIdentity) return false;
              if (!needle) return true;
              const hay = [
                user.email,
                user.contact,
                user.product?.accountRef,
                user.homeBinding?.displayName,
                user.homeBinding?.socks5Host,
                user.homeBinding?.proxyName,
              ].filter(Boolean).join(' ').toLowerCase();
              return hay.includes(needle);
            });
            if (visible.length === 0) {
              return <div className="state"><strong>没有找到这样的客户</strong></div>;
            }
            const heartbeats = new Map(
              (activity.state === 'ready' ? activity.data.users : []).map((row) => [row.userId, row]),
            );
            return <table className="users-table">
            <thead>
              <tr>
                <th>客户</th>
                <th>状态</th>
                <th>探测</th>
                <th>凭证</th>
                <th>用量</th>
                <th>家宽</th>
                <th>Claude</th>
                <th>线路</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((user) => {
                const nowSec = Math.floor(Date.now() / 1_000);
                const expired = user.expiresAt != null && user.expiresAt <= nowSec;
                const opened = expanded === user.id;
                return <Fragment key={user.id}>
                <tr
                  className={`${expired ? 'row-expired ' : ''}${opened ? 'open' : ''} click-row`}
                  onClick={() => setExpanded(opened ? null : user.id)}
                >
                <td>
                  <span className="expand-caret" aria-hidden>{opened ? '▾' : '▸'}</span>
                  <strong>{user.email}</strong>
                  {user.product?.incomplete && <span className="expired-flag">没开 Claude</span>}
                </td>
                <td>
                  <Status value={user.status} />
                  {expired && <span className="expired-flag">已过期</span>}
                </td>
                <td>
                  {(() => {
                    const beat = heartbeats.get(user.id);
                    if (!beat) return <span className="muted">无心跳</span>;
                    return (
                      <div>
                        <strong>{beat.selectedServer ?? '未选节点'}</strong>
                        {beat.selectedServer && (
                          <small className={`chip chip-${nodeHealthTone(beat.nodeHealth)}`}>
                            {beat.nodeHealthLabel || nodeHealthLabel(beat.nodeHealth)}
                          </small>
                        )}
                        <small className="mono">{formatExitDelay(beat.exitDelayMs)} · {formatTcpDelay(beat.tcpDelayMs)}</small>
                      </div>
                    );
                  })()}
                </td>
                <td>
                  {user.hasExitIdentity
                    ? <span className="muted">已有</span>
                    : <span className="expired-flag">没有</span>}
                </td>
                <td className="mono">{formatBytes(user.usageBytes)}</td>
                <td>
                  {user.homeBinding ? (
                    <div>
                      <strong>{user.homeBinding.displayName}</strong>
                      <small className="mono">
                        {user.homeBinding.kind === 'socks5'
                          ? `${user.homeBinding.socks5Host}:${user.homeBinding.socks5Port}`
                          : user.homeBinding.proxyName}
                      </small>
                    </div>
                  ) : <span className="muted">未绑定</span>}
                </td>
                <td>
                  {user.product?.accountRef
                    ? <>
                      <strong>{user.product.accountRef}</strong>
                      <small className="muted">换过 {user.product.replaceCount} 次</small>
                    </>
                    : <span className="muted">未开通</span>}
                </td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="assign-line">
                    <input
                      className="input compact"
                      type="text"
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="host:port:user:pass"
                      value={assignLine[user.id] ?? ''}
                      onChange={(e) => setAssignLine((prev) => ({ ...prev, [user.id]: e.target.value }))}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy || !(assignLine[user.id] ?? '').trim()}
                      onClick={() => assignPasted(user)}
                    >{user.homeBinding ? '换线路' : '绑定'}</button>
                  </div>
                </td>
                </tr>
                {opened && (
                  <tr className="detail-row">
                    <td colSpan={7}>
                      <UserWorkbench
                        user={user}
                        busy={busy}
                        activeHomes={activeHomes}
                        unusedHomes={unusedHomes}
                        sharedProxies={sharedProxies}
                        bindPick={bindPick[user.id] || user.homeBinding?.homeExitId || ''}
                        defaultPick={defaultPick[user.id] ?? user.homeBinding?.defaultProxyName ?? ''}
                        expiryPick={expiryPick[user.id] ?? ''}
                        onBindPick={(value) => setBindPick((prev) => ({ ...prev, [user.id]: value }))}
                        onDefaultPick={(value) => setDefaultPick((prev) => ({ ...prev, [user.id]: value }))}
                        onExpiryPick={(value) => setExpiryPick((prev) => ({ ...prev, [user.id]: value }))}
                        onBind={() => bindHome(user)}
                        onUnbind={() => unbindHome(user)}
                        onToggle={() => toggleUser(user)}
                        onExpiry30={() => setExpiry(user, Math.floor(Date.now() / 1_000) + 30 * 86_400)}
                        onApplyExpiry={() => applyExpiryPick(user)}
                        onClearExpiry={() => setExpiry(user, null)}
                        onResetUsage={() => resetUsage(user)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>;
              })}
            </tbody>
          </table>;
          }}
        </StateBoundary>
      </div>
    </section>

    <HomesPage />
  </div>;
}

function UserWorkbench({
  user, busy, activeHomes, unusedHomes, sharedProxies,
  bindPick, defaultPick, expiryPick,
  onBindPick, onDefaultPick, onExpiryPick,
  onBind, onUnbind, onToggle, onExpiry30, onApplyExpiry, onClearExpiry, onResetUsage,
}: {
  user: UserDto;
  busy: boolean;
  activeHomes: HomeExitDto[];
  unusedHomes: HomeExitDto[];
  sharedProxies: string[];
  bindPick: string;
  defaultPick: string;
  expiryPick: string;
  onBindPick: (value: string) => void;
  onDefaultPick: (value: string) => void;
  onExpiryPick: (value: string) => void;
  onBind: () => void;
  onUnbind: () => void;
  onToggle: () => void;
  onExpiry30: () => void;
  onApplyExpiry: () => void;
  onClearExpiry: () => void;
  onResetUsage: () => void;
}) {
  const nowSec = Math.floor(Date.now() / 1_000);
  const aliveDays = Math.max(0, Math.floor((nowSec - user.createdAt) / 86_400));
  const remainDays = user.expiresAt == null ? null : Math.ceil((user.expiresAt - nowSec) / 86_400);
  const homes = unusedHomes.length > 0 ? unusedHomes : activeHomes;
  return (
    <div className="user-workbench">
      <div className="workbench-meta">
        <span>注册 {timestamp(user.createdAt)} · {aliveDays} 天</span>
        <span>到期 {user.expiresAt ? `${timestamp(user.expiresAt)}（剩 ${remainDays} 天）` : '不限'}</span>
        <span>连接凭证 {user.hasExitIdentity ? '已有' : '没有'}</span>
        <span>用量 {formatBytes(user.usageBytes)}</span>
      </div>
      <div className="workbench-ops">
        <select className="input compact" value={bindPick} onChange={(e) => onBindPick(e.target.value)} disabled={busy || homes.length === 0}>
          <option value="">{homes.length ? '从库存选一条家宽' : '没有可绑的线路'}</option>
          {homes.map((home) => (
            <option key={home.id} value={home.id}>
              {home.displayName} ({home.kind === 'socks5' ? `${home.socks5Host}:${home.socks5Port}` : home.proxyName})
            </option>
          ))}
        </select>
        <select className="input compact" value={defaultPick} onChange={(e) => onDefaultPick(e.target.value)} disabled={busy || sharedProxies.length === 0}>
          <option value="">{sharedProxies.length ? '默认节点（可不选）' : '没有可选节点'}</option>
          {sharedProxies.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onBind}>
          {user.homeBinding ? '保存' : '绑上'}
        </button>
        {user.homeBinding && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onUnbind}>解开</button>
        )}
        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={onToggle}>
          {user.status === 'active' ? '注销' : '恢复账号'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onExpiry30}>+30 天</button>
        <input className="input compact" type="datetime-local" value={expiryPick} onChange={(e) => onExpiryPick(e.target.value)} disabled={busy} />
        <button type="button" className="btn btn-outline btn-sm" disabled={busy || !expiryPick} onClick={onApplyExpiry}>设到期</button>
        {user.expiresAt != null && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClearExpiry}>取消到期</button>
        )}
        {user.usageBytes > 0 && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={busy}
            onClick={onResetUsage}
            title="当前用量算已经结过，从现在重新算"
          >这期清零</button>
        )}
      </div>
      <UserDetailPanel user={user} />
    </div>
  );
}

function DeviceActions({ deviceId, onChanged }: { deviceId: string; onChanged: () => void }) {
  const history = useResource(() => operationsApi.deviceActions(deviceId), [deviceId]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: string, confirmFirst = false) {
    if (confirmFirst && !confirm('只在这台已经断线保护时再试一次？正常连着的不会被断开。')) return;
    setBusy(true);
    setMessage(null);
    try {
      await operationsApi.enqueueDeviceAction(deviceId, action);
      setMessage('已发出');
      history.reload();
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '下发失败');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!confirm('撤销这台设备并踢下线？')) return;
    setBusy(true);
    try {
      await operationsApi.revokeDevice(deviceId);
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '撤销失败');
    } finally {
      setBusy(false);
    }
  }

  const latest = history.state === 'ready' ? history.data[0] : null;
  return (
    <div className="device-actions">
      <div className="row-actions">
        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => run('diagnostic_snapshot')}>诊断</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => run('claude_traffic_snapshot')}>流量快照</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => run('refresh_catalog')}>刷新节点</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => run('retry_protection', true)}>重试断线保护</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => revoke()}>撤销</button>
      </div>
      {message && <div className="muted">{message}</div>}
      {latest && (
        <div className="muted">最近：{latest.action} · {latest.status} · {timestamp(latest.createdAt)}</div>
      )}
    </div>
  );
}

function ProductLedger({ user, detail, onChanged }: {
  user: UserDto;
  detail: UserDetailDto | null;
  onChanged: () => void;
}) {
  const [accountRef, setAccountRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const current = detail?.product?.accounts.find((account) => account.status === 'assigned') ?? null;
  const daysUsed = (account: ProductAccountDto) => {
    const start = account.openedAt ?? account.createdAt;
    const end = account.closedAt ?? Math.floor(Date.now() / 1000);
    return Math.max(0, Math.floor((end - start) / 86_400));
  };

  async function openAccount() {
    if (!accountRef.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await operationsApi.createProductAccount({ userId: user.id, accountRef: accountRef.trim() });
      setAccountRef('');
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '开通失败');
    } finally {
      setBusy(false);
    }
  }

  async function ban() {
    if (!current || !confirm(`标记 ${current.accountRef} 已封号？`)) return;
    setBusy(true);
    try {
      await operationsApi.banProductAccount(current.id);
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '封号失败');
    } finally {
      setBusy(false);
    }
  }

  async function replace() {
    if (!current || !accountRef.trim()) return;
    if (!confirm(`用 ${accountRef.trim()} 替换 ${current.accountRef}？`)) return;
    setBusy(true);
    try {
      await operationsApi.replaceProductAccount(current.id, accountRef.trim());
      setAccountRef('');
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '换号失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detail-block">
      <h3>Claude 账号</h3>
      <div className="muted detail-note">
        第一次开通 {user.firstEntitledAt ? timestamp(user.firstEntitledAt) : '—'}
        {user.firstEntitledAt ? ` · 已用 ${Math.max(0, Math.floor((Date.now() / 1000 - user.firstEntitledAt) / 86400))} 天` : ''}
        {` · 换过 ${detail?.product?.replaceCount ?? user.product?.replaceCount ?? 0} 次`}
      </div>
      {current ? (
        <p>
          现在用 <strong>{current.accountRef}</strong>
          <small className="muted"> · 这个号用了 {daysUsed(current)} 天</small>
        </p>
      ) : <p className="muted">现在没有在用的号</p>}
      <div className="assign-line">
        <input
          className="input compact"
          placeholder="账号"
          value={accountRef}
          onChange={(e) => setAccountRef(e.target.value)}
          disabled={busy}
        />
        {current
          ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !accountRef.trim()} onClick={replace}>换号</button>
          : <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !accountRef.trim()} onClick={openAccount}>开通</button>}
        {current && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={ban}>标记封号</button>}
      </div>
      {message && <div className="muted">{message}</div>}
      {detail?.product?.events && detail.product.events.length > 0 && (
        <ul className="detail-list">
          {detail.product.events.slice(0, 8).map((event) => (
            <li key={event.id}>
              <span>{event.type}</span>
              <span className="muted">{timestamp(event.at)}{event.detail ? ` · ${event.detail}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UserDetailPanel({ user }: { user: UserDto }) {
  const detail = useResource<UserDetailDto>(() => operationsApi.userDetail(user.id), [user.id]);
  const quotaPct = user.quotaBytes
    ? Math.min(100, (user.usageBytes / user.quotaBytes) * 100)
    : null;

  const prettyReport = (raw: string) => {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  };

  return (
    <div className="user-detail">
      <div className="detail-grid">
        <div className="detail-block">
          <h3>用量</h3>
          <div className="usage-line mono">
            {formatBytes(user.usageBytes)}{user.quotaBytes != null ? ` / ${formatBytes(user.quotaBytes)}` : ' / 不限'}
          </div>
          {quotaPct !== null && (
            <div className="usage-track">
              <div
                className={`usage-fill${quotaPct > 90 ? ' danger' : ''}`}
                style={{ width: `${Math.max(2, quotaPct)}%` }}
              />
            </div>
          )}
          <div className="muted detail-note">
            注册 {timestamp(user.createdAt)} · 最多 {user.deviceLimit} 台设备
            {user.expiresAt ? ` · 到期 ${timestamp(user.expiresAt)}` : ''}
            {user.contact ? ` · ${user.contact}` : ''}
          </div>
          {detail.state === 'ready' && detail.data.heartbeat && (
            <div className="muted detail-note">
              上次心跳 {timeAgo(detail.data.heartbeat.lastSeenAt)}
              {detail.data.heartbeat.selectedServer ? ` · ${detail.data.heartbeat.selectedServer}` : ''}
              {detail.data.heartbeat.selectedServer
                ? ` · ${detail.data.heartbeat.nodeHealthLabel || nodeHealthLabel(detail.data.heartbeat.nodeHealth)}`
                : ''}
              {` · ${formatExitDelay(detail.data.heartbeat.exitDelayMs)}`}
              {` · ${formatTcpDelay(detail.data.heartbeat.tcpDelayMs)}`}
              {` · ${detail.data.heartbeat.clientVersion}`}
            </div>
          )}
        </div>

        <ProductLedger
          user={user}
          detail={detail.state === 'ready' ? detail.data : null}
          onChanged={detail.reload}
        />

        <div className="detail-block">
          <h3>设备{detail.state === 'ready' ? `（${detail.data.devices.length}）` : ''}</h3>
          {detail.state === 'loading' && <span className="muted">加载中…</span>}
          {detail.state === 'error' && <span className="muted">{detail.message}</span>}
          {detail.state === 'ready' && (detail.data.devices.length > 0 ? (
            <ul className="detail-list">
              {detail.data.devices.map((device) => (
                <li key={device.id}>
                  <Status value={device.status} />
                  <strong>{device.name}</strong>
                  <span className="muted">{timestamp(device.updatedAt)}</span>
                  {device.status !== 'revoked' && <DeviceActions deviceId={device.id} onChanged={detail.reload} />}
                </li>
              ))}
            </ul>
          ) : <span className="muted">还没有设备</span>)}
        </div>

        <div className="detail-block">
          <h3>诊断报告{detail.state === 'ready' ? `（${detail.data.diagnostics.length}）` : ''}</h3>
          {detail.state === 'loading' && <span className="muted">加载中…</span>}
          {detail.state === 'error' && <span className="muted">{detail.message}</span>}
          {detail.state === 'ready' && (detail.data.diagnostics.length > 0 ? (
            <ul className="detail-list">
              {detail.data.diagnostics.map((report) => (
                <li key={report.referenceCode}>
                  <details>
                    <summary>
                      <code>{report.referenceCode}</code>
                      <span className="muted"> · {timestamp(report.receivedAt)} · {report.clientVersion} · {report.osVersion}</span>
                    </summary>
                    <pre className="report-json">{prettyReport(report.reportJson)}</pre>
                  </details>
                </li>
              ))}
            </ul>
          ) : <span className="muted">还没有诊断报告</span>)}
        </div>
      </div>
    </div>
  );
}

function HomesPage() {
  const { refreshMs } = useRefresh();
  const homes = useResource(operationsApi.homeExits, [], refreshMs);
  const [proxyName, setProxyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [egressIpv4, setEgressIpv4] = useState('');
  const [kind, setKind] = useState<'catalog' | 'socks5'>('catalog');
  const [socks5Host, setSocks5Host] = useState('');
  const [socks5Port, setSocks5Port] = useState('');
  const [socks5Username, setSocks5Username] = useState('');
  const [socks5Password, setSocks5Password] = useState('');
  const [notes, setNotes] = useState('');
  const [importText, setImportText] = useState('');
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
    setMessage(null);
    try {
      const result = await operationsApi.importHomeLines(lines);
      const parts = [
        result.created.length ? `加了 ${result.created.length} 条` : null,
        result.skipped.length ? `跳过 ${result.skipped.length} 条已存在` : null,
        result.failed.length ? `失败 ${result.failed.length} 条` : null,
      ].filter(Boolean);
      setMessage(parts.join(' · ') || '没有新的线路');
      if (result.failed.length > 0) {
        setError(result.failed.map((item) => item.message).join('；'));
      }
      if (result.created.length > 0) setImportText('');
      homes.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入库存失败');
    } finally {
      setBusy(false);
    }
  }

  async function createHome(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const created = await operationsApi.createHomeExit({
        proxyName: proxyName.trim(),
        displayName: displayName.trim(),
        egressIpv4: egressIpv4.trim() || undefined,
        kind,
        ...(kind === 'socks5' ? {
          socks5Host: socks5Host.trim(),
          socks5Port: Number(socks5Port),
          socks5Username,
          socks5Password,
        } : {}),
        notes: notes.trim() || undefined,
      });
      setMessage(`已加上 ${created.displayName}（${created.proxyName}）`);
      setProxyName('');
      setDisplayName('');
      setEgressIpv4('');
      setKind('catalog');
      setSocks5Host('');
      setSocks5Port('');
      setSocks5Username('');
      setSocks5Password('');
      setNotes('');
      homes.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function removeHome(home: HomeExitDto) {
    if (!confirm(`删除家宽「${home.displayName}」？要先把绑着的客户都解开。`)) return;
    setBusy(true);
    setError(null);
    try {
      await operationsApi.deleteHomeExit(home.id);
      setMessage(`已删除 ${home.displayName}`);
      homes.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(home: HomeExitDto, status: string) {
    setBusy(true);
    setError(null);
    try {
      await operationsApi.updateHomeExit(home.id, { status });
      homes.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
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
          <h2>批量加家宽</h2>
          <p>每行一条，格式 <code>host:port:user:pass</code>，也可以是 <code>user:pass@host:port</code> 或 <code>socks5://…</code>。先加进库存，之后再绑给客户。</p>
        </div>
      </div>
      <div className="card-body">
        <form className="stack" onSubmit={importLines}>
          <textarea
            className="input control-textarea"
            rows={4}
            spellCheck={false}
            autoComplete="off"
            placeholder={'198.51.100.10:6886:user:pass\nuser:pass@gw.example.com:11080'}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            disabled={busy}
          />
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy || !importText.trim()}>加入库存</button>
          </div>
        </form>
      </div>
    </section>

    <details className="card extras-fold">
      <summary className="extras-summary">手动登记线路（一般不用）</summary>
      <div className="card-body">
        <form className="form-grid" onSubmit={createHome}>
          <label>
            <span>名称</span>
            <input className="input" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="比如：上海电信" disabled={busy} />
          </label>
          <label>
            <span>节点名</span>
            <input className="input" required value={proxyName} onChange={(e) => setProxyName(e.target.value)} placeholder="目录里的节点名" disabled={busy} />
          </label>
          <label>
            <span>类型</span>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as 'catalog' | 'socks5')} disabled={busy}>
              <option value="catalog">目录里的节点</option>
              <option value="socks5">SOCKS5 家宽</option>
            </select>
          </label>
          {kind === 'socks5' && (
            <>
              <label>
                <span>SOCKS5 主机</span>
                <input className="input" required value={socks5Host} onChange={(e) => setSocks5Host(e.target.value)} placeholder="203.0.113.50 或 gw.example.com" disabled={busy} />
              </label>
              <label>
                <span>SOCKS5 端口</span>
                <input className="input" required type="number" min={1} max={65535} value={socks5Port} onChange={(e) => setSocks5Port(e.target.value)} placeholder="11080" disabled={busy} />
              </label>
              <label>
                <span>SOCKS5 用户名</span>
                <input className="input" required value={socks5Username} onChange={(e) => setSocks5Username(e.target.value)} disabled={busy} />
              </label>
              <label>
                <span>SOCKS5 密码</span>
                <input className="input" required type="password" value={socks5Password} onChange={(e) => setSocks5Password(e.target.value)} disabled={busy} />
              </label>
            </>
          )}
          <label>
            <span>出口公网 IP（可选）</span>
            <input className="input" value={egressIpv4} onChange={(e) => setEgressIpv4(e.target.value)} placeholder="203.0.113.10" disabled={busy} />
          </label>
          <label>
            <span>备注（可选）</span>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="机房 / 联系人" disabled={busy} />
          </label>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy}>加上</button>
          </div>
        </form>
      </div>
    </details>

    <section className="card">
      <div className="card-header">
        <div>
          <h2>家宽库存</h2>
          <p>启用后才能绑给客户。</p>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => homes.reload()} disabled={busy}>刷新</button>
      </div>
      <div className="table-wrap">
        <StateBoundary resource={homes} empty={(rows: HomeExitDto[]) => rows.length === 0}>
          {(rows) => <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>节点名</th>
                <th>类型</th>
                <th>地址</th>
                <th>状态</th>
                <th>检测</th>
                <th>更新</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((home) => <tr key={home.id}>
                <td><strong>{home.displayName}</strong>{home.notes ? <small>{home.notes}</small> : null}</td>
                <td className="mono">{home.proxyName}</td>
                <td className="mono">{home.kind}</td>
                <td className="mono">{home.kind === 'socks5' ? `${home.socks5Host}:${home.socks5Port}` : (home.egressIpv4 || '—')}</td>
                <td><Status value={home.status} /></td>
                <td className="muted">
                  {home.probeStatus ? `${home.probeStatus}${home.lastProbedAt ? ` · ${timeAgo(home.lastProbedAt)}` : ''}` : '—'}
                  {home.probeUptimeRatio != null && (
                    <small className="muted">历史在线 {(home.probeUptimeRatio * 100).toFixed(0)}%（{home.probeAlive}/{home.probeTotal}）</small>
                  )}
                </td>
                <td className="muted">{timestamp(home.updatedAt)}</td>
                <td>
                  <div className="row-actions">
                    {home.status !== 'active' && (
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setStatus(home, 'active')}>启用</button>
                    )}
                    {home.status === 'active' && (
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus(home, 'disabled')}>停用</button>
                    )}
                    <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => removeHome(home)}>删除</button>
                  </div>
                </td>
              </tr>)}
            </tbody>
          </table>}
        </StateBoundary>
      </div>
    </section>
  </div>;
}
