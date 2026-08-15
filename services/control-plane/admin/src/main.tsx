import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { REFRESH_CHOICES, RefreshProvider, pages, usePage, useRefresh } from './hooks';
import { ControlPage } from './pages/ControlPage';
import { Dashboard } from './pages/Dashboard';
import { MonitorPage } from './pages/MonitorPage';
import { UsersPage } from './pages/UsersPage';
import { Icon, icons } from './ui';
import './styles.css';

function App() {
  const page = usePage();
  const selected = pages.find((entry) => entry.id === page)!;
  const { refreshMs, setRefreshMs } = useRefresh();
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
            <small>运维</small>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="运维页面">
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
          <span className="muted">唯一运维入口</span>
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
            <span className="badge">Access admin</span>
          </div>
        </header>

        <div className="content">
          <div className="page-head">
            <div>
              <h1>{selected.label}</h1>
              <p>
                {page === 'dashboard' && '红条、库存、谁在线、该处理谁'}
                {page === 'monitor' && '探测、指标、余量、续费、打开账单'}
                {page === 'users' && '开通、派线、Claude 账本'}
                {page === 'control' && '替换节点目录和精确直连策略'}
              </p>
            </div>
          </div>

          {page === 'dashboard' && <Dashboard />}
          {page === 'monitor' && <MonitorPage />}
          {page === 'users' && <UsersPage />}
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
