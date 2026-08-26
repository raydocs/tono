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
import { dataHealthLines } from './lib/health';
import './styles.css';

const PRIMARY: Array<'dashboard' | 'failures' | 'monitor' | 'users'> = [
  'dashboard', 'failures', 'monitor', 'users',
];

function App() {
  const { route, page, setRoute, openNode, openUser } = useOpsRoute();
  const selected = pages.find((entry) => entry.id === page) ?? pages[0];
  const { refreshMs, setRefreshMs } = useRefresh();
  const privacy = usePrivacy();
  const world = useOpsWorld();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState(route.q ?? '');
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

  const health = dataHealthLines([
    { label: '节点', state: world.live.state, stale: world.live.stale, refreshedAt: world.live.refreshedAt },
    { label: '客户', state: world.users.state, stale: world.users.stale, refreshedAt: world.users.refreshedAt },
    { label: '谁在线', state: world.activity.state, stale: world.activity.stale, refreshedAt: world.activity.refreshedAt },
  ], Date.now());

  function submitSearch() {
    const needle = search.trim().toLowerCase();
    if (!needle) return;
    const node = world.nodes.find((item) => item.name.toLowerCase().includes(needle)
      || (item.quality?.publicIp ?? '').includes(needle));
    if (node) {
      openNode(node.name);
      return;
    }
    const person = world.people.find((item) => item.email.toLowerCase().includes(needle)
      || item.userId.toLowerCase().includes(needle));
    if (person) openUser(person.userId);
  }

  return (
    <>
    <OpsBackground />
    <div className={`shell${showMore ? ' show-more' : ''}`}>
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
                >
                  <Icon d={icons[entry.id]} />
                  <span>{entry.label}</span>
                </a>
              ))}
            </div>
          ))}
          <button type="button" className="nav-item nav-more" onClick={() => setShowMore((value) => !value)}>
            <span>⋯</span>
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
            <input
              ref={searchRef}
              className="input compact search-input"
              type="search"
              placeholder="搜索节点或客户  /"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitSearch();
              }}
            />
            {health.length > 0 && (
              <span className={`health-compact${health.some((line) => line.includes('没加载')) ? ' bad' : ''}`} title={health.join(' ')}>
                {health[0]}
              </span>
            )}
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
              <select
                className="control-select"
                value={refreshMs}
                onChange={(event) => setRefreshMs(Number(event.target.value))}
              >
                {REFRESH_CHOICES.map((choice) => (
                  <option key={choice.ms} value={choice.ms}>{choice.label}</option>
                ))}
              </select>
            </label>
            <span className="badge">已登录</span>
          </div>
        </header>

        <div className="content">
          <div className="page-head">
            <div>
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
          </div>

          {page === 'dashboard' && <Dashboard />}
          {page === 'failures' && <FailuresPage />}
          {page === 'monitor' && <MonitorPage />}
          {page === 'users' && <UsersPage />}
          {page === 'traffic' && <TrafficPage />}
          {page === 'control' && <ControlPage />}
        </div>
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
