import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { REFRESH_CHOICES, RefreshProvider, pages, useRefresh } from './hooks';
import { ControlPage } from './pages/ControlPage';
import { Dashboard } from './pages/Dashboard';
import { MonitorPage } from './pages/MonitorPage';
import { UsersPage } from './pages/UsersPage';
import { FailuresPage } from './pages/FailuresPage';
import { TrafficPage } from './pages/TrafficPage';
import { Icon, icons } from './ui';
import { OpsBackground } from './Background';
import { OpsDataProvider, useOpsWorld } from './ops-context';
import { PrivacyProvider, usePrivacy } from './privacy';
import { useOpsRoute } from './lib/route';
import { compactHealthLine, dataHealthLines, sourceTruthHealthLines } from './lib/health';
import './styles.css';

const PRIMARY: Array<'dashboard' | 'failures' | 'monitor' | 'users'> = [
  'dashboard', 'failures', 'monitor', 'users',
];

function searchOptionId(kind: 'node' | 'user', value: string) {
  // `aria-activedescendant` is an ID reference. Node names contain spaces and
  // middle dots, so the human label cannot safely double as the DOM id.
  return `ops-search-${kind}-${encodeURIComponent(value)}`;
}

function App() {
  const { route, page, setRoute, openNode, openUser } = useOpsRoute();
  const selected = pages.find((entry) => entry.id === page) ?? pages[0];
  const { refreshMs, setRefreshMs } = useRefresh();
  const privacy = usePrivacy();
  const world = useOpsWorld();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState(route.q ?? '');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(() => {
    const saved = localStorage.getItem('tono-ops-theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  });
  const [showMore, setShowMore] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
      document.querySelector<HTMLMetaElement>('#color-scheme')?.setAttribute('content', resolved);
    };
    localStorage.setItem('tono-ops-theme', theme);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((event.key === '/' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      // The overflow strip floats over the page, so Escape has to reach it.
      if (event.key === 'Escape') setShowMore(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, typeof pages>();
    for (const entry of pages) {
      const list = map.get(entry.group) ?? [];
      list.push(entry);
      map.set(entry.group, list);
    }
    return [...map.entries()];
  }, []);

  const healthAt = Date.now();
  const health = dataHealthLines([
    { label: '节点', state: world.live.state, stale: world.live.stale, refreshedAt: world.live.refreshedAt },
    { label: '客户', state: world.users.state, stale: world.users.stale, refreshedAt: world.users.refreshedAt },
    { label: '谁在线', state: world.activity.state, stale: world.activity.stale, refreshedAt: world.activity.refreshedAt },
  ], healthAt).concat(world.live.state === 'ready' ? sourceTruthHealthLines([
    { label: '节点质量', source: world.sources.quality },
    { label: '机器探针', source: world.sources.agents },
  ], healthAt) : []);
  const healthUnavailable = health.some((line) => (
    line.includes('没加载') || line.includes('不可用')
  ));

  const needle = search.trim().toLowerCase();
  const nodeHits = needle
    ? world.nodes.filter((item) => item.name.toLowerCase().includes(needle)
      || (item.quality?.publicIp ?? '').toLowerCase().includes(needle)
      || (item.profile?.provider ?? '').toLowerCase().includes(needle)).slice(0, 6)
    : [];
  const personHits = needle
    ? world.people.filter((item) => item.email.toLowerCase().includes(needle)
      || item.userId.toLowerCase().includes(needle)).slice(0, 6)
    : [];
  const hits = [
    ...nodeHits.map((node) => ({ kind: 'node' as const, id: node.name, label: node.name })),
    ...personHits.map((person) => ({ kind: 'user' as const, id: person.userId, label: privacy.email(person.email) })),
  ];
  const refreshing = [world.live, world.users, world.activity].some((resource) => resource.refreshing);

  function goHit(hit: (typeof hits)[number]) {
    setSearchOpen(false);
    setSearch('');
    if (hit.kind === 'node') openNode(hit.id, { page: 'monitor', focus: null });
    else openUser(hit.id, { page: 'users', focus: null });
  }

  return (
    <>
    <a className="skip-link" href="#ops-main">跳到正文</a>
    <OpsBackground />
    <div className={`shell${showMore ? ' show-more' : ''}`}>
      {showMore && (
        <button type="button" className="nav-more-scrim" aria-label="收起更多" onClick={() => setShowMore(false)} />
      )}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">T</span>
          <div className="brand-text">
            <strong>Tono</strong>
            <small>后台</small>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="后台页面">
          {groups.map(([group, items]) => (
            <div key={group} className="nav-block">
              <div className="nav-group">{group}</div>
              {items.map((entry) => (
                <a
                  key={entry.id}
                  className={`nav-item${page === entry.id ? ' active' : ''}${PRIMARY.includes(entry.id as typeof PRIMARY[number]) ? '' : ' nav-overflow'}`}
                  href={`#/${entry.id}`}
                  onClick={() => setShowMore(false)}
                >
                  <Icon d={icons[entry.id]} />
                  <span>{entry.label}</span>
                </a>
              ))}
            </div>
          ))}
          <button type="button" className="nav-item nav-more" aria-expanded={showMore} onClick={() => setShowMore((value) => !value)}>
            <span className="nav-more-glyph" aria-hidden>⋯</span>
            <span>更多</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <span className="muted">内部后台</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <div className="breadcrumb">
              <span>Tono</span>
              <span className="sep">/</span>
              <span className="current">{selected.label}</span>
            </div>
          </div>
          <div className="topbar-right">
            <div className="search-wrap">
              <input
                ref={searchRef}
                className="input compact search-input"
                type="search"
                aria-label="搜索节点或客户"
                placeholder="搜索节点或客户  /"
                value={search}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={Boolean(searchOpen && needle)}
                aria-controls="ops-search-results"
                aria-activedescendant={searchOpen && needle && hits[searchIndex] ? searchOptionId(hits[searchIndex].kind, hits[searchIndex].id) : undefined}
                onChange={(event) => { setSearch(event.target.value); setSearchOpen(true); setSearchIndex(0); }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setSearchOpen(false);
                    searchRef.current?.blur();
                    return;
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    if (hits.length === 0) return;
                    setSearchIndex((value) => Math.min(hits.length - 1, value + 1));
                    return;
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    if (hits.length === 0) return;
                    setSearchIndex((value) => Math.max(0, value - 1));
                    return;
                  }
                  if (event.key === 'Enter' && hits[searchIndex]) {
                    event.preventDefault();
                    goHit(hits[searchIndex]);
                  }
                }}
                onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
              />
              {searchOpen && needle && (
                <div className="search-pop" id="ops-search-results">
                  {hits.length === 0 && <p className="muted" role="status">没有匹配的节点或客户</p>}
                  {hits.length > 0 && (
                    <div role="listbox" aria-label="搜索结果">
                      {nodeHits.length > 0 && (
                        <div role="group" aria-label="节点">
                          {nodeHits.map((node) => (
                            <button
                              type="button"
                              role="option"
                              id={searchOptionId('node', node.name)}
                              aria-selected={hits[searchIndex]?.kind === 'node' && hits[searchIndex]?.id === node.name}
                              className={`search-hit${hits[searchIndex]?.id === node.name && hits[searchIndex]?.kind === 'node' ? ' active' : ''}`}
                              key={`n-${node.name}`}
                              onMouseDown={(event) => { event.preventDefault(); goHit({ kind: 'node', id: node.name, label: node.name }); }}
                            >{node.name}</button>
                          ))}
                        </div>
                      )}
                      {personHits.length > 0 && (
                        <div role="group" aria-label="客户">
                          {personHits.map((person) => (
                            <button
                              type="button"
                              role="option"
                              id={searchOptionId('user', person.userId)}
                              aria-selected={hits[searchIndex]?.kind === 'user' && hits[searchIndex]?.id === person.userId}
                              className={`search-hit${hits[searchIndex]?.id === person.userId && hits[searchIndex]?.kind === 'user' ? ' active' : ''}`}
                              key={`u-${person.userId}`}
                              onMouseDown={(event) => { event.preventDefault(); goHit({ kind: 'user', id: person.userId, label: person.email }); }}
                            >{privacy.email(person.email)}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            {refreshing && <span className="status-pill refreshing-dot">刷新中</span>}
            {health.length > 0 && (
              <span
                className={`health-compact ${healthUnavailable ? 'bad' : 'warn'}`}
                title={health.join(' ')}
                role="status"
              >
                <span className="health-wide">{compactHealthLine(health[0])}</span>
                <span className="health-mobile">{healthUnavailable ? '数据不可用' : '数据已过期'}</span>
              </span>
            )}
            <div className="topbar-extras">
              <div className="ctl-group">
                <label className="ctl-item" title="隐私模式：遮住邮箱、IP、密钥和金额">
                  <input type="checkbox" checked={privacy.privacy} onChange={(event) => privacy.setPrivacy(event.target.checked)} />
                  隐私
                </label>
                <label className="ctl-item" title="主题">
                  <select className="control-select" aria-label="主题" value={theme} onChange={(event) => setTheme(event.target.value as typeof theme)}>
                    <option value="system">跟随系统</option>
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                  </select>
                </label>
                <label className="ctl-item" title="自动刷新间隔">
                  <select
                    className="control-select"
                    aria-label="自动刷新"
                    value={refreshMs}
                    onChange={(event) => setRefreshMs(Number(event.target.value))}
                  >
                    {REFRESH_CHOICES.map((choice) => (
                      <option key={choice.ms} value={choice.ms}>{`刷新 ${choice.label}`}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <details className="topbar-compact-more">
              <summary>设置</summary>
              <div className="topbar-more-panel">
                <label className="muted">
                  <input type="checkbox" checked={privacy.privacy} onChange={(event) => privacy.setPrivacy(event.target.checked)} />
                  隐私
                </label>
                <label className="muted">
                  主题
                  <select className="control-select" value={theme} onChange={(event) => setTheme(event.target.value as typeof theme)}>
                    <option value="system">跟随系统</option>
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                  </select>
                </label>
                <label className="muted">
                  自动刷新
                  <select className="control-select" value={refreshMs} onChange={(event) => setRefreshMs(Number(event.target.value))}>
                    {REFRESH_CHOICES.map((choice) => (
                      <option key={choice.ms} value={choice.ms}>{choice.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            </details>
            <span className="badge">已登录</span>
          </div>
        </header>

        <main className="content" id="ops-main" tabIndex={-1}>
          <div className="page-head">
            <h1>{selected.label}</h1>
            <p>
              {page === 'dashboard' && '事故、在线客户、该处理的节点'}
              {page === 'failures' && '机房事故和客户路径'}
              {page === 'monitor' && '机器全集、三网、下架'}
              {page === 'users' && '开通、家宽、路径'}
              {page === 'traffic' && '机器累计与客户本期用量'}
              {page === 'control' && '节点目录和国内直连规则'}
            </p>
          </div>

          {page === 'dashboard' && <Dashboard />}
          {page === 'failures' && <FailuresPage />}
          {page === 'monitor' && <MonitorPage />}
          {page === 'users' && <UsersPage />}
          {page === 'traffic' && <TrafficPage />}
          {page === 'control' && <ControlPage />}
        </main>
      </div>
    </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RefreshProvider>
      <OpsDataProvider>
        <PrivacyProvider>
          <App />
        </PrivacyProvider>
      </OpsDataProvider>
    </RefreshProvider>
  </StrictMode>,
);
