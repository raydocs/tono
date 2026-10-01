import { EmptyLine } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
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
    <Section title={copy.diagnosticsPanel.sessionsTitle}>
      {resource.status === 'loading' ? <EmptyLine message={copy.diagnosticsPanel.sessionsLoading} /> : null}
      {resource.status === 'error' ? (
        <EmptyLine message={copy.diagnosticsPanel.sessionsUnavailable} />
      ) : null}
      {data && data.sessions.length === 0 ? <EmptyLine message={copy.diagnosticsPanel.sessionsNone} /> : null}
      {data && data.sessions.length > 0 ? (
        <ul className="grid gap-2">
          {data.sessions.map((session) => (
            <li key={session.id} className="text-sm">
              <span className="font-mono">{session.node ?? copy.diagnosticsPanel.sessionNoNode}</span>
              <span className="text-[var(--muted-foreground)]">
                {' '}
                {session.outcome ?? copy.diagnosticsPanel.sessionRunning}
                {session.appVersion ? ` · ${session.appVersion}` : ''}
                {session.bytesDown != null ? copy.diagnosticsPanel.sessionDown(session.bytesDown) : ''}
                {session.bytesUp != null ? copy.diagnosticsPanel.sessionUp(session.bytesUp) : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {data && data.dnsChecks.some((check) => check.leakOutside || check.ipv6Leak) ? (
        <p className="text-sm">{copy.diagnosticsPanel.dnsLeft}</p>
      ) : null}
      {data && data.hops.some((hop) => hop.connected === false) ? (
        <p className="text-sm">{copy.diagnosticsPanel.hopDown}</p>
      ) : null}
    </Section>
  );
}
