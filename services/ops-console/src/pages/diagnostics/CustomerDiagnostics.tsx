import { EmptyLine } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { getJson } from '@/lib/api';
import { useResource } from '@/lib/use-resource';
import type { CustomerDiagnostics as CustomerDiagnosticsDto } from './types';

/**
 * One customer's privacy-safe diagnostics: session, hop, DNS.
 * No email and no full IP. Isolated so it can move with `pages/diagnostics`.
 */
export function CustomerDiagnostics({ userId }: { userId: string }) {
  const resource = useResource(`diagnostics:${userId}`, (signal) =>
    getJson<CustomerDiagnosticsDto>(
      `customers/${encodeURIComponent(userId)}/diagnostics`,
      signal,
    ),
  );
  const data = resource.status === 'ready' ? resource.data : null;
  return (
    <Section title="自动诊断">
      {resource.status === 'loading' ? <EmptyLine message="正在读取自动诊断…" /> : null}
      {resource.status === 'error' ? (
        <EmptyLine message="这份自动诊断还读不到。控制面接口部署之后，这里会显示会话、链路和 DNS。" />
      ) : null}
      {data && data.sessions.length === 0 ? <EmptyLine message="还没有自动诊断会话。" /> : null}
      {data && data.sessions.length > 0 ? (
        <ul className="grid gap-2">
          {data.sessions.map((session) => (
            <li key={session.id} className="text-sm">
              <span className="font-mono">{session.node ?? '未选节点'}</span>
              <span className="text-[var(--muted-foreground)]">
                {' '}
                {session.outcome ?? '进行中'}
                {session.appVersion ? ` · ${session.appVersion}` : ''}
                {session.bytesDown != null ? ` · 下行 ${session.bytesDown}` : ''}
                {session.bytesUp != null ? ` · 上行 ${session.bytesUp}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {data && data.dnsChecks.some((check) => check.leakOutside || check.ipv6Leak) ? (
        <p className="text-sm">有一次 DNS 检查没有留在隧道里。</p>
      ) : null}
      {data && data.hops.some((hop) => hop.connected === false) ? (
        <p className="text-sm">有一跳没有连上。</p>
      ) : null}
    </Section>
  );
}
