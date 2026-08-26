import { useState } from 'react';
import { operationsApi, type HomeExitDto, type ProductAccountDto, type UserDetailDto, type UserDto } from '../../api';
import type { Live } from '../../hooks';
import { catalogProxyNames } from '../../lib/catalog';
import { unixDateTimeLocal } from '../../lib/fields';
import { formatBytes, timestamp } from '../../lib/format';
import { usePrivacy } from '../../privacy';
import { Banner, Skeleton, Status, Unavailable } from '../../ui';
import { useAsk } from './ask';
import { useMutation } from './mutate';

export function CustomerOperations({
  user,
  detail,
  detailPending,
  homes,
  catalog,
  focus,
  onChanged,
}: {
  user: UserDto;
  detail: UserDetailDto | null;
  detailPending: boolean;
  homes: Live<HomeExitDto[]>;
  catalog: Live<{ yaml: string }>;
  focus: string | null;
  onChanged: () => void;
}) {
  const privacy = usePrivacy();
  const ask = useAsk();
  const expiry = useMutation();
  const home = useMutation();
  const [bindPick, setBindPick] = useState('');
  const [defaultPick, setDefaultPick] = useState(user.homeBinding?.defaultProxyName || '');
  const [assignLine, setAssignLine] = useState('');
  const [expiryPick, setExpiryPick] = useState('');
  const [accountRef, setAccountRef] = useState('');
  const homeRows = homes.state === 'ready' ? homes.data : [];
  const unusedHomes = homeRows.filter((row) => row.status === 'active' && row.kind === 'socks5' && (row.bindCount ?? 0) === 0);
  const bindable = unusedHomes.length > 0 ? unusedHomes : homeRows.filter((row) => row.status === 'active');
  const homeNames = new Set(homeRows.map((row) => row.proxyName));
  const sharedProxies = catalog.state === 'ready' ? catalogProxyNames(catalog.data.yaml).filter((name) => !homeNames.has(name)) : [];
  const current = detail?.product?.accounts.find((account) => account.status === 'assigned') ?? null;
  const opened = (id: string) => focus === id;
  const canSaveStock = Boolean(bindPick || user.homeBinding);

  return (
    <div>
      {ask.dialog}
      <Banner message={expiry.ok || home.ok} tone="ok" />
      <Banner message={expiry.error || home.error} tone="error" />

      <details className="drawer-section" open={opened('expired') || opened('expiring')}>
        <summary><h3>到期</h3></summary>
        <p className="muted">{user.expiresAt ? timestamp(user.expiresAt) : '不限'}</p>
        <div className="form-row">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={expiry.busy}
            onClick={() => void expiry.run(
              () => operationsApi.setUserExpiry(user.id, Math.floor(Date.now() / 1000) + 30 * 86400).then(() => onChanged()),
              `${privacy.email(user.email)} +30 天`,
            )}
          >+30 天</button>
          <input className="input compact" type="datetime-local" value={expiryPick} onChange={(event) => setExpiryPick(event.target.value)} />
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={expiry.busy || !expiryPick}
            onClick={() => {
              const seconds = unixDateTimeLocal(expiryPick);
              if (seconds === 'invalid' || seconds == null) {
                expiry.setError('到期时间无效，没有保存。');
                return;
              }
              void expiry.run(
                () => operationsApi.setUserExpiry(user.id, seconds).then(() => onChanged()),
                `${privacy.email(user.email)} 将于 ${timestamp(seconds)} 到期`,
              );
            }}
          >设到期</button>
          {user.expiresAt != null && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={expiry.busy}
              onClick={() => void expiry.run(
                () => operationsApi.setUserExpiry(user.id, null).then(() => onChanged()),
                `已取消 ${privacy.email(user.email)} 的到期限制`,
              )}
            >取消到期</button>
          )}
        </div>
      </details>

      <details className="drawer-section" open={opened('quota')}>
        <summary><h3>用量</h3></summary>
        <p className="mono">{formatBytes(user.usageBytes)}{user.quotaBytes == null ? ' / 不限' : ` / ${formatBytes(user.quotaBytes)}`}</p>
        <p className="muted">清零是把本期基线推到当前累计，不是删服务器历史。</p>
        {user.usageBytes > 0 && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={expiry.busy}
            onClick={() => ask.prompt(
              `把 ${privacy.email(user.email)} 这期流量清零？`,
              `现在的 ${formatBytes(user.usageBytes)} 算已经结过，从现在重新算。服务器上的历史累计不会删，也撤不回。`,
              async () => {
                await operationsApi.resetUserUsage(user.id);
                onChanged();
                expiry.setOk(`${privacy.email(user.email)} 这期流量已清零`);
              },
            )}
          >这期清零</button>
        )}
      </details>

      <details className="drawer-section" open={opened('home')}>
        <summary><h3>家宽</h3></summary>
        <p>{user.homeBinding ? `${user.homeBinding.displayName} · ${privacy.ip(user.homeBinding.socks5Host || user.homeBinding.egressIpv4)}` : '未绑定'}</p>
        {homes.state === 'loading' && <Skeleton label="家宽库存" />}
        {homes.state === 'error' && <Unavailable title="家宽库存不可用" detail={homes.message} />}
        {catalog.state === 'loading' && <p className="muted">目录还没回来，默认节点列表暂时空着。</p>}
        {catalog.state === 'error' && <Unavailable title="目录不可用" detail={catalog.message} />}
        <div className="stack home-form">
          <input className="input compact" placeholder="host:port:user:pass" value={assignLine} onChange={(event) => setAssignLine(event.target.value)} spellCheck={false} />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={home.busy || !assignLine.trim()}
            onClick={() => {
              const assign = async () => {
                const result = await operationsApi.assignHomeLine({
                  userId: user.id,
                  line: assignLine.trim(),
                  defaultProxyName: defaultPick || null,
                  replace: Boolean(user.homeBinding),
                });
                onChanged();
                home.setOk(result.replaced
                  ? `已给 ${privacy.email(user.email)} 换成 ${result.homeExit.displayName}`
                  : `已给 ${privacy.email(user.email)} 绑上 ${result.homeExit.displayName}`);
              };
              if (user.homeBinding) {
                ask.prompt(
                  `给 ${privacy.email(user.email)} 换家宽？`,
                  '没人用的旧线路会停掉。确认后才会改绑定。',
                  assign,
                );
              } else {
                void home.run(assign);
              }
            }}
          >{user.homeBinding ? '换线路' : '绑定线路'}</button>
          <select className="input compact" value={bindPick} onChange={(event) => setBindPick(event.target.value)} disabled={homes.state !== 'ready'}>
            <option value="">{homes.state !== 'ready' ? '库存未就绪' : bindable.length ? '从库存选一条' : '没有可绑的线路'}</option>
            {bindable.map((row) => (
              <option key={row.id} value={row.id}>{row.displayName} ({privacy.ip(row.socks5Host)})</option>
            ))}
          </select>
          <select className="input compact" value={defaultPick} onChange={(event) => setDefaultPick(event.target.value)}>
            <option value="">默认节点（可不选）</option>
            {sharedProxies.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={home.busy || !canSaveStock}
            onClick={() => {
              const homeExitId = bindPick || user.homeBinding?.homeExitId;
              if (!homeExitId) return;
              void home.run(
                () => operationsApi.bindUserHome(user.id, { homeExitId, defaultProxyName: defaultPick || null }).then((binding) => {
                  onChanged();
                  home.setOk(`已给 ${privacy.email(user.email)} 绑上 ${binding.displayName}`);
                }),
              );
            }}
          >保存库存绑定</button>
          {user.homeBinding && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={home.busy}
              onClick={() => ask.prompt(
                `解开 ${privacy.email(user.email)} 的家宽？`,
                '绑定会去掉，线路回到库存。客户下次拉目录才生效。',
                async () => {
                  await operationsApi.unbindUserHome(user.id);
                  onChanged();
                  home.setOk(`已解开 ${privacy.email(user.email)} 的家宽`);
                },
              )}
            >解开</button>
          )}
        </div>
      </details>

      <details className="drawer-section" open={opened('claude')}>
        <summary><h3>Claude</h3></summary>
        {detailPending && <Skeleton label="Claude 资料" />}
        <ClaudeBlock
          user={user}
          current={current}
          events={detail?.product?.events ?? []}
          accountRef={accountRef}
          setAccountRef={setAccountRef}
          onChanged={onChanged}
        />
      </details>
    </div>
  );
}

function ClaudeBlock({
  user, current, events, accountRef, setAccountRef, onChanged,
}: {
  user: UserDto;
  current: ProductAccountDto | null;
  events: NonNullable<UserDetailDto['product']>['events'];
  accountRef: string;
  setAccountRef: (value: string) => void;
  onChanged: () => void;
}) {
  const privacy = usePrivacy();
  const ask = useAsk();
  const claude = useMutation();
  const days = current?.openedAt != null
    ? Math.max(0, Math.floor((Date.now() / 1000 - current.openedAt) / 86_400))
    : null;
  return (
    <div>
      {ask.dialog}
      <Banner message={claude.ok} tone="ok" />
      <Banner message={claude.error} tone="error" />
      <p className="muted">第一次开通 {user.firstEntitledAt ? timestamp(user.firstEntitledAt) : '—'} · 换过 {user.product?.replaceCount ?? 0} 次</p>
      {current ? (
        <p>
          现在用 <strong>{privacy.secret(current.accountRef)}</strong>
          {days != null ? ` · 已用 ${days} 天` : ''}
        </p>
      ) : <p className="muted">现在没有在用的号</p>}
      <div className="assign-line">
        <input className="input compact" placeholder="账号" value={accountRef} onChange={(event) => setAccountRef(event.target.value)} />
        {current ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={claude.busy || !accountRef.trim()}
            onClick={() => ask.prompt(
              `用新号替换 ${privacy.secret(current.accountRef)}？`,
              `新号会写上 ${privacy.secret(accountRef.trim())}。旧号标记为已替换。`,
              async () => {
                await operationsApi.replaceProductAccount(current.id, accountRef.trim());
                setAccountRef('');
                onChanged();
                claude.setOk('已换号');
              },
            )}
          >换号</button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={claude.busy || !accountRef.trim()}
            onClick={() => void claude.run(
              () => operationsApi.createProductAccount({ userId: user.id, accountRef: accountRef.trim() }).then(() => { setAccountRef(''); onChanged(); }),
              '已开通',
            )}
          >开通</button>
        )}
        {current && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={claude.busy}
            onClick={() => ask.prompt(
              `标记 ${privacy.secret(current.accountRef)} 已封号？`,
              '这个号不能再给客户用。确认后才会改状态。',
              async () => {
                await operationsApi.banProductAccount(current.id);
                onChanged();
                claude.setOk('已标记封号');
              },
            )}
          >标记封号</button>
        )}
      </div>
      {events.length > 0 && (
        <ul className="detail-list">
          {events.slice(0, 8).map((event) => (
            <li key={event.id}>
              <span>{event.type}{event.detail ? ` · ${event.detail}` : ''}</span>
              <span className="muted">{timestamp(event.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
