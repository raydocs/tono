import { useMemo, useState } from 'react';
import { operationsApi } from '../api';
import { useResource } from '../hooks';
import { personMatchesFocus } from '../lib/ops-views';
import { useOpsWorld } from '../ops-context';
import { useOpsRoute } from '../lib/route';
import { FilterChips, Skeleton, Unavailable } from '../ui';
import { CustomerDrawer } from './users/CustomerDrawer';
import { CustomerList } from './users/CustomerList';
import { HomesInventory } from './users/HomesInventory';
import { OnboardDrawer } from './users/OnboardDrawer';

const FILTERS = [
  { id: '', label: '全部' },
  { id: 'online', label: '在线' },
  { id: 'path', label: '路径差' },
  { id: 'unmeasured', label: '路径未测' },
  { id: 'quota', label: '额度' },
  { id: 'expired', label: '过期' },
  { id: 'expiring', label: '将到期' },
  { id: 'catalog', label: '目录落后' },
  { id: 'catalog-unreported', label: '在线未报' },
  { id: 'claude', label: 'Claude' },
  { id: 'home', label: '没家宽' },
  { id: 'credential', label: '没凭证' },
];

export function UsersPage() {
  const world = useOpsWorld();
  const { route, setRoute, openUser, closeDrawer } = useOpsRoute();
  const [query, setQuery] = useState('');
  const [onboard, setOnboard] = useState(false);
  const homesMode = route.focus === 'homes';
  const wantHomes = homesMode || Boolean(route.user) || onboard;
  const wantPooled = onboard;
  const homes = useResource(operationsApi.homeExits, [], 120_000, wantHomes);
  const pooled = useResource(() => operationsApi.productAccounts('pooled'), [], 120_000, wantPooled);
  const focus = route.focus === 'homes' ? '' : (route.focus ?? '');
  const people = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return world.people.filter((person) => {
      if (!personMatchesFocus(person, focus || null)) return false;
      if (!needle) return true;
      return `${person.email} ${person.user?.contact ?? ''} ${person.user?.product?.accountRef ?? ''} ${person.user?.homeBinding?.displayName ?? ''}`.toLowerCase().includes(needle);
    });
  }, [world.people, focus, query]);
  const selected = world.people.find((person) => person.userId === route.user) ?? null;

  return (
    <div className="stack">
      {world.activity.state === 'error' && !world.activity.refreshedAt && (
        <Unavailable title="客户心跳不可用，无法判断在线和路径" detail={world.activity.message} />
      )}
      {world.users.state === 'error' && !world.users.refreshedAt && (
        <Unavailable title="客户列表没加载上来" detail={world.users.message} />
      )}

      {homesMode ? (
        <>
          <div className="customer-toolbar">
            <button type="button" className="btn btn-outline" onClick={() => setRoute((current) => ({ ...current, page: 'users', focus: null }))}>返回客户</button>
          </div>
          <HomesInventory homes={homes} />
        </>
      ) : (
        <>
          <div className="customer-toolbar">
            <input className="input compact search-input sensitive-value" type="search" aria-label="搜索客户" placeholder="搜索邮箱" value={query} onChange={(event) => setQuery(event.target.value)} />
            <button type="button" className="btn" onClick={() => setOnboard(true)}>开通客户</button>
            <button type="button" className="btn btn-outline" onClick={() => setRoute((current) => ({ ...current, page: 'users', focus: 'homes', user: null }))}>家宽库存</button>
          </div>
          <FilterChips
            value={focus}
            options={FILTERS.map((item) => ({
              ...item,
              count: item.id === ''
                ? world.people.length
                : world.people.filter((person) => personMatchesFocus(person, item.id)).length,
            }))}
            onChange={(id) => setRoute((current) => ({ ...current, page: 'users', focus: id || null, user: current.user }))}
          />
          {world.users.state === 'loading' && world.people.length === 0
            ? <Skeleton label="正在加载客户" />
            : <CustomerList people={people} selectedUserId={route.user} onOpen={(userId) => openUser(userId)} />}
        </>
      )}

      <CustomerDrawer
        person={selected}
        open={Boolean(route.user)}
        focus={route.focus}
        publishedRevision={world.catalogRevision}
        catalog={world.catalog}
        homes={homes}
        onClose={closeDrawer}
        onChanged={() => { world.users.reload(); world.activity.reload(); }}
      />
      <OnboardDrawer
        open={onboard}
        homes={homes}
        pooled={pooled}
        onClose={() => setOnboard(false)}
        onDone={() => { world.users.reload(); }}
      />
    </div>
  );
}
