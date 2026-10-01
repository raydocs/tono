import { lazy, Suspense } from 'react';
import { Loading } from './ds';
import { Home } from './pages/Home';
import { Shell } from './Shell';
import { useHash } from './state';

const Observe = lazy(() => import('./pages/Observe'));
const Nodes = lazy(() => import('./pages/Nodes'));
const NodeDetail = lazy(() => import('./pages/NodeDetail'));
const Customers = lazy(() => import('./pages/Customers'));
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'));
const Residential = lazy(() => import('./pages/Residential'));
const Clients = lazy(() => import('./pages/Clients'));
const Finance = lazy(() => import('./pages/Finance'));
const Settings = lazy(() => import('./pages/Settings'));
const Audit = lazy(() => import('./pages/Audit'));
const Design = lazy(() => import('./pages/Design'));

function resolve(hash: string): { crumbs: string[]; page: React.ReactNode } {
  const [path] = hash.split('?');
  const [, head = '', rest] = path.split('/');
  const id = rest ? decodeURIComponent(path.split('/').slice(2).join('/')) : null;
  switch (head) {
    case '': return { crumbs: ['概览'], page: <Home /> };
    case 'observe': return { crumbs: ['运行', '连接质量'], page: <Observe /> };
    case 'nodes': return id ? { crumbs: ['运行', '节点', id], page: <NodeDetail name={id} /> } : { crumbs: ['运行', '节点'], page: <Nodes /> };
    case 'residential': return { crumbs: ['运行', '家宽出口'], page: <Residential /> };
    case 'customers': return id ? { crumbs: ['客户', '客户', id], page: <CustomerDetail id={id} /> } : { crumbs: ['客户', '客户'], page: <Customers /> };
    case 'clients': return { crumbs: ['客户', '客户端'], page: <Clients /> };
    case 'finance': return { crumbs: ['客户', '财务'], page: <Finance /> };
    case 'settings': return { crumbs: ['管理', '设置'], page: <Settings section={id} /> };
    case 'audit': return { crumbs: ['管理', '审计'], page: <Audit /> };
    case 'design': return { crumbs: ['管理', '设计规范'], page: <Design /> };
    default: return { crumbs: ['找不到'], page: <div className="py-24 text-center text-muted">没有这一页</div> };
  }
}

export function App() {
  const hash = useHash();
  const { crumbs, page } = resolve(hash);
  return (
    <Shell hash={hash.split('?')[0]} crumbs={crumbs}>
      <Suspense fallback={<Loading rows={6} />}>{page}</Suspense>
    </Shell>
  );
}
