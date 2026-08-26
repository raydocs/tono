import { useState } from 'react';
import { operationsApi, type HomeExitDto, type ProductAccountDto, type UserDetailDto, type UserDto } from '../../api';
import { formatBytes, timestamp } from '../../lib/format';
import { catalogProxyNames } from '../../lib/catalog';
import { usePrivacy } from '../../privacy';
import { Banner, Status } from '../../ui';
import { useAsk } from './ask';

export function CustomerOperations({
  user,
  detail,
  homes,
  catalogYaml,
  focus,
  onChanged,
}: {
  user: UserDto;
  detail: UserDetailDto | null;
  homes: HomeExitDto[];
  catalogYaml: string | null;
  focus: string | null;
  onChanged: () => void;
}) {
  const privacy = usePrivacy();
  const ask = useAsk();
  const [bindPick, setBindPick] = useState(user.homeBinding?.homeExitId || '');
  const [defaultPick, setDefaultPick] = useState(user.homeBinding?.defaultProxyName || '');
  const [assignLine, setAssignLine] = useState('');
  const [expiryPick, setExpiryPick] = useState('');
  const [accountRef, setAccountRef] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const unusedHomes = homes.filter((home) => home.status === 'active' && home.kind === 'socks5' && (home.bindCount ?? 0) === 0);
  const bindable = unusedHomes.length > 0 ? unusedHomes : homes.filter((home) => home.status === 'active');
  const homeNames = new Set(homes.map((home) => home.proxyName));
  const sharedProxies = catalogYaml ? catalogProxyNames(catalogYaml).filter((name) => !homeNames.has(name)) : [];
  const current = detail?.product?.accounts.find((account) => account.status === 'assigned') ?? null;
  const open = (id: string) => focus === id || focus == null;

  async function after(ok: string) {
    setMessage(ok);
    onChanged();
  }

  return (
    <div>
      {ask.dialog}
      <Banner message={message} tone="ok" />

      <details className="drawer-section" open={open('expired') || open('expiring')}>
        <summary><h3>到期</h3></summary>
        <p className="muted">{user.expiresAt ? timestamp(user.expiresAt) : '不限'}</p>
        <div className="form-row">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => operationsApi.setUserExpiry(user.id, Math.floor(Date.now() / 1000) + 30 * 86400).then(() => after(`${privacy.email(user.email)} +30 天`))}>+30 天</button>
          <input className="input compact" type="datetime-local" value={expiryPick} onChange={(event) => setExpiryPick(event.target.value)} />
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={!expiryPick}
            onClick={() => {
              const seconds = Math.floor(new Date(expiryPick).getTime() / 1000);
              operationsApi.setUserExpiry(user.id, seconds).then(() => after(`${privacy.email(user.email)} 将于 ${timestamp(seconds)} 到期`));
            }}
          >设到期</button>
          {user.expiresAt != null && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => operationsApi.setUserExpiry(user.id, null).then(() => after(`已取消 ${privacy.email(user.email)} 的到期限制`))}>取消到期</button>
          )}
        </div>
      </details>

      <details className="drawer-section" open={open('quota')}>
        <summary><h3>用量</h3></summary>
        <p className="mono">{formatBytes(user.usageBytes)}{user.quotaBytes == null ? ' / 不限' : ` / ${formatBytes(user.quotaBytes)}`}</p>
        <p className="muted">清零是把本期基线推到当前累计，不是删服务器历史。</p>
        {user.usageBytes > 0 && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => ask.prompt(
              `把 ${privacy.email(user.email)} 这期流量清零？`,
              `现在的 ${formatBytes(user.usageBytes)} 算已经结过，从现在重新算。服务器上的历史累计不会删，也撤不回。`,
              () => operationsApi.resetUserUsage(user.id).then(() => after(`${privacy.email(user.email)} 这期流量已清零`)),
            )}
          >这期清零</button>
        )}
      </details>

      <details className="drawer-section" open={open('home')}>
        <summary><h3>家宽</h3></summary>
        <p>{user.homeBinding ? `${user.homeBinding.displayName} · ${privacy.ip(user.homeBinding.socks5Host || user.homeBinding.egressIpv4)}` : '未绑定'}</p>
        <input className="input compact" placeholder="host:port:user:pass" value={assignLine} onChange={(event) => setAssignLine(event.target.value)} spellCheck={false} />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!assignLine.trim()}
          onClick={() => {
            const go = () => operationsApi.assignHomeLine({
              userId: user.id,
              line: assignLine.trim(),
              defaultProxyName: defaultPick || null,
              replace: Boolean(user.homeBinding),
            }).then((result) => after(result.replaced
              ? `已给 ${privacy.email(user.email)} 换成 ${result.homeExit.displayName}`
              : `已给 ${privacy.email(user.email)} 绑上 ${result.homeExit.displayName}`));
            if (user.homeBinding) {
              ask.prompt(
                `给 ${privacy.email(user.email)} 换家宽？`,
                '没人用的旧线路会停掉。确认后才会改绑定。',
                go,
              );
            } else {
              go();
            }
          }}
        >{user.homeBinding ? '换线路' : '绑定线路'}</button>
        <select className="input compact" value={bindPick} onChange={(event) => setBindPick(event.target.value)}>
          <option value="">{bindable.length ? '从库存选一条' : '没有可绑的线路'}</option>
          {bindable.map((home) => (
            <option key={home.id} value={home.id}>{home.displayName} ({privacy.ip(home.socks5Host)})</option>
          ))}
        </select>
        <select className="input compact" value={defaultPick} onChange={(event) => setDefaultPick(event.target.value)}>
          <option value="">默认节点（可不选）</option>
          {sharedProxies.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => operationsApi.bindUserHome(user.id, { homeExitId: bindPick || user.homeBinding?.homeExitId, defaultProxyName: defaultPick || null }).then((binding) => after(`已给 ${privacy.email(user.email)} 绑上 ${binding.displayName}`))}
        >保存库存绑定</button>
        {user.homeBinding && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => ask.prompt(
              `解开 ${privacy.email(user.email)} 的家宽？`,
              '绑定会去掉，线路回到库存。客户下次拉目录才生效。',
              () => operationsApi.unbindUserHome(user.id).then(() => after(`已解开 ${privacy.email(user.email)} 的家宽`)),
            )}
          >解开</button>
        )}
      </details>

      <details className="drawer-section" open={open('claude')}>
        <summary><h3>Claude</h3></summary>
        <ClaudeBlock user={user} current={current} events={detail?.product?.events ?? []} accountRef={accountRef} setAccountRef={setAccountRef} onChanged={onChanged} />
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
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div>
      {ask.dialog}
      <Banner message={message} tone="ok" />
      <p className="muted">第一次开通 {user.firstEntitledAt ? timestamp(user.firstEntitledAt) : '—'} · 换过 {user.product?.replaceCount ?? 0} 次</p>
      {current ? <p>现在用 <strong>{privacy.secret(current.accountRef)}</strong></p> : <p className="muted">现在没有在用的号</p>}
      <div className="assign-line">
        <input className="input compact" placeholder="账号" value={accountRef} onChange={(event) => setAccountRef(event.target.value)} />
        {current ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!accountRef.trim()}
            onClick={() => ask.prompt(
              `用新号替换 ${privacy.secret(current.accountRef)}？`,
              `新号会写上 ${privacy.secret(accountRef.trim())}。旧号标记为已替换。`,
              () => operationsApi.replaceProductAccount(current.id, accountRef.trim()).then(() => { setAccountRef(''); onChanged(); setMessage('已换号'); }),
            )}
          >换号</button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!accountRef.trim()}
            onClick={() => operationsApi.createProductAccount({ userId: user.id, accountRef: accountRef.trim() }).then(() => { setAccountRef(''); onChanged(); })}
          >开通</button>
        )}
        {current && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => ask.prompt(
              `标记 ${privacy.secret(current.accountRef)} 已封号？`,
              '这个号不能再给客户用。确认后才会改状态。',
              () => operationsApi.banProductAccount(current.id).then(() => onChanged()),
            )}
          >标记封号</button>
        )}
      </div>
      {events.length > 0 && (
        <ul className="detail-list">
          {events.slice(0, 8).map((event) => (
            <li key={event.id}><span>{event.type}</span><span className="muted">{timestamp(event.at)}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}
