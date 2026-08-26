import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { REFRESH_CHOICES, RefreshProvider, pages, usePage, useRefresh } from './hooks';
import { ControlPage } from './pages/ControlPage';
import { Dashboard } from './pages/Dashboard';
import { MonitorPage } from './pages/MonitorPage';
import { UsersPage } from './pages/UsersPage';
import { FailuresPage } from './pages/FailuresPage';
import { TrafficPage } from './pages/TrafficPage';
import { Icon, icons } from './ui';
import './styles.css';

function App() {
  const page = usePage();
  const selected = pages.find((entry) => entry.id === page)!;
  const { refreshMs, setRefreshMs } = useRefresh();
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(() => {
    const saved = localStorage.getItem('tono-ops-theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  });
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
  const groups = useMemo(() => {
    const map = new Map<string, typeof pages>();
    for (const entry of pages) {
      const list = map.get(entry.group) ?? [];
      list.push(entry);
      map.set(entry.group, list);
    }
    return [...map.entries()];
  }, []);

  return (
    <div className="shell">
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
                  className={`nav-item${page === entry.id ? ' active' : ''}`}
                  href={`#/${entry.id}`}
                >
                  <Icon d={icons[entry.id]} />
                  <span>{entry.label}</span>
                </a>
              ))}
            </div>
          ))}
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
                {page === 'dashboard' && '看告警、库存和谁在线'}
                {page === 'failures' && '集中处理客户和节点故障'}
                {page === 'monitor' && '看节点状态、余量和续费'}
                {page === 'users' && '开通客户、绑家宽、管 Claude'}
                {page === 'traffic' && '核对客户本期用量'}
                {page === 'control' && '更新节点目录和国内直连规则'}
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
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RefreshProvider>
      <App />
    </RefreshProvider>
  </StrictMode>,
);
