import type { ReactNode, SVGProps } from 'react';
import type { Live, Resource } from './hooks';
import { dataHealthLines } from './lib/health';

export function Icon({ d, ...props }: SVGProps<SVGSVGElement> & { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-icon" aria-hidden {...props}>
      <path d={d} />
    </svg>
  );
}

export const icons = {
  dashboard: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1',
  users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  monitor: 'M22 12h-4l-3 9L9 3l-3 9H2',
  control: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
} as const;

export const statusLabels: Record<string, string> = {
  active: '正常',
  disabled: '已注销',
  retired: '停用',
  banned: '已封号',
  assigned: '在用',
  pooled: '库存',
  pending: '待确认',
  revoked: '已撤销',
  degraded: '异常',
  failed: '失败',
  alive: '通',
  dead: '不通',
  untested: '未测',
};

export function Status({ value }: { value: string }) {
  const key = value.replaceAll('_', '-');
  return <span className={`status status-${key}`}>{statusLabels[value] ?? value.replaceAll('_', ' ')}</span>;
}

export function StateBoundary<T>({ resource, empty, children }: {
  resource: Resource<T>;
  empty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (resource.state === 'loading') {
    return <div className="state"><span className="spinner" /><strong>加载中</strong><span>正在加载…</span></div>;
  }
  if (resource.state === 'error') {
    return <div className="state state-error"><strong>无法加载</strong><span>{resource.message}</span></div>;
  }
  if (empty?.(resource.data)) {
    return <div className="state"><strong>还没有内容</strong><span>这里暂时是空的。</span></div>;
  }
  return children(resource.data);
}

/**
 * Renders what `dataHealthLines` has to say about this page's sources. The
 * reasoning for saying it at all lives with that function.
 */
export function DataHealth({ sources }: {
  sources: Array<{ label: string; resource: Live<unknown> }>;
}) {
  const lines = dataHealthLines(
    sources.map(({ label, resource }) => ({
      label,
      state: resource.state,
      stale: resource.stale,
      refreshedAt: resource.refreshedAt,
    })),
    Date.now(),
  );
  if (!lines.length) return null;
  return <Banner tone="error" message={lines.join(' ')} />;
}

export function Banner({ message, tone = 'info' }: { message: string | null; tone?: 'info' | 'error' | 'ok' }) {
  if (!message) return null;
  return <div className={`banner banner-${tone}`}>{message}</div>;
}
