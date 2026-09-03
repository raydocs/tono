import { useEffect, useMemo, useState } from 'react';
import { operationsApi, type ActivityUserDto } from '../api';
import { useRefresh, useResource } from '../hooks';
import { personMatchesFocus, type OpsPersonView } from '../lib/ops-views';
import { useOpsWorld } from '../ops-context';
import { useOpsRoute } from '../lib/route';
import { formatOpsHash, parseOpsHash } from '../lib/hash';
import { usePrivacy } from '../privacy';
import { Banner, FilterChips, Skeleton, Unavailable } from '../ui';
import { CustomerDrawer } from './users/CustomerDrawer';
import { CustomerList } from './users/CustomerList';
import { HomesInventory } from './users/HomesInventory';
import { OnboardDrawer } from './users/OnboardDrawer';
import { useAsk } from './users/ask';

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
  const privacy = usePrivacy();
  const { route, setRoute, openUser, closeDrawer } = useOpsRoute();
  const { refreshMs } = useRefresh();
  const [query, setQuery] = useState(route.q ?? '');
  const [onboard, setOnboard] = useState(false);
  useEffect(() => { setQuery(route.q ?? ''); }, [route.q]);
  useEffect(() => {
    // A persisted search can contain a customer email. Entering
    // screenshot/privacy mode must remove it from the browser URL as well as
    // obscuring the input. Read the hash itself rather than `route`, which can
    // lag a replaceState.
    if (!privacy.privacy) return;
    const current = parseOpsHash(window.location.hash);
    if (current.q) {
      history.replaceState(null, '', formatOpsHash({ ...current, page: 'users', q: null }));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }, [privacy.privacy, route]);
  const homesMode = route.focus === 'homes';
  const wantHomes = homesMode || Boolean(route.user) || onboard;
  const wantPooled = onboard || Boolean(route.user);
  const slow = refreshMs ? Math.max(refreshMs, 120_000) : 0;
  const homes = useResource(operationsApi.homeExits, [], slow, wantHomes);
  const pooled = useResource(() => operationsApi.productAccounts('pooled'), [], slow, wantPooled);
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
  const peoplePending = world.users.state === 'loading' || world.activity.state === 'loading';

  function onSearch(value: string) {
    setQuery(value);
    const next = formatOpsHash({
      ...route,
      page: 'users',
      q: privacy.privacy ? null : value || null,
    });
    if (window.location.hash !== next) {
      history.replaceState(null, '', next);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }

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
            <input className="input compact search-input sensitive-value" type="search" aria-label="搜索客户" placeholder="搜索邮箱" value={query} onChange={(event) => onSearch(event.target.value)} />
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
          {(focus === 'catalog' || focus === 'expiring') && (
            <CohortActions
              focus={focus}
              people={people}
              activityRows={world.activity.state === 'ready' ? world.activity.data.users : null}
              onDone={() => { world.users.reload(); world.activity.reload(); }}
            />
          )}
          {world.users.state === 'loading' && world.people.length === 0
            ? <Skeleton label="正在加载客户" />
            : <CustomerList people={people} selectedUserId={route.user} onOpen={openUser} />}
        </>
      )}

      <CustomerDrawer
        person={selected}
        pending={peoplePending}
        open={Boolean(route.user)}
        focus={route.focus}
        publishedRevision={world.catalogRevision}
        catalog={world.catalog}
        homes={homes}
        pooled={pooled}
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

function CohortActions({
  focus,
  people,
  activityRows,
  onDone,
}: {
  focus: 'catalog' | 'expiring';
  people: OpsPersonView[];
  activityRows: ActivityUserDto[] | null;
  onDone: () => void;
}) {
  const privacy = usePrivacy();
  const ask = useAsk();
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const devicesByUser = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of activityRows ?? []) {
      if (!row.online || !row.deviceId) continue;
      const list = map.get(row.userId) ?? [];
      if (!list.includes(row.deviceId)) list.push(row.deviceId);
      map.set(row.userId, list);
    }
    return map;
  }, [activityRows]);

  const targets = focus === 'catalog'
    ? people.filter((person) => (devicesByUser.get(person.userId) ?? []).length > 0)
    : people.filter((person) => person.user != null);

  if (targets.length === 0) return null;

  // One person failing must not stop the rest; each failure is named so the
  // operator knows exactly who still needs a hand.
  async function runBatch(
    perPerson: (person: OpsPersonView) => Promise<void>,
    okText: (count: number) => string,
  ) {
    const failures: string[] = [];
    let done = 0;
    for (const person of targets) {
      try {
        await perPerson(person);
        done += 1;
      } catch (err) {
        failures.push(`${privacy.email(person.email)}（${err instanceof Error ? err.message : '没做成'}）`);
      }
    }
    setOk(done > 0 ? okText(done) : null);
    setError(failures.length ? `${failures.length} 位没做成：${failures.join('；')}` : null);
    onDone();
  }

  return (
    <div className="cohort-bar">
      {ask.dialog}
      <Banner message={ok} tone="ok" />
      <Banner message={error} tone="error" />
      {focus === 'catalog' ? (
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={ask.busy}
          onClick={() => ask.prompt(
            `给这 ${targets.length} 位客户的在线设备下发刷新目录？`,
            '按人逐个下发，失败的会单独列出，不会因为一位失败就停下。确认后才会执行。',
            () => runBatch(
              async (person) => {
                for (const deviceId of devicesByUser.get(person.userId) ?? []) {
                  await operationsApi.enqueueDeviceAction(deviceId, 'refresh_catalog');
                }
              },
              (count) => `已给 ${count} 位客户的在线设备下发刷新目录`,
            ),
          )}
        >给这 {targets.length} 位客户的在线设备下发刷新目录</button>
      ) : (
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={ask.busy}
          onClick={() => ask.prompt(
            `给这 ${targets.length} 位续 30 天？`,
            '每位都从今天和原到期日里较晚的那天起加 30 天，不会缩短还没到期的。确认后才会执行。',
            () => runBatch(
              async (person) => {
                const nowSec = Math.floor(Date.now() / 1000);
                const next = Math.max(nowSec, person.user!.expiresAt ?? nowSec) + 30 * 86400;
                await operationsApi.setUserExpiry(person.user!.id, next);
              },
              (count) => `已给 ${count} 位续 30 天`,
            ),
          )}
        >给这 {targets.length} 位续 30 天</button>
      )}
    </div>
  );
}
