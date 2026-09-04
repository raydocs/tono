import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProtectedRouteProofSection } from './CustomerDrawer';

describe('protected route proof', () => {
  const proof = {
    source: 'device_action' as const,
    status: 'succeeded',
    createdAt: 1_800_000_000,
    completedAt: 1_800_000_010,
    evidence: {
      verdict: 'confirmed' as const,
      observedSince: 1_799_999_900,
      residentialReported: true,
      routes: { observed: 8, residential: 2, proxied: 5, direct: 0, blocked: 1, unknown: 0 },
      connected: true,
      killSwitchArmed: true,
      tunPresent: true,
      protectedDNSConfigured: true,
      exitIdentityConsistency: 'MATCHED' as const,
      physicalBypassProbe: 'BLOCKED' as const,
      unsafeProtectionObservationCount: 0,
      protectedDirectConnectionCount: 0,
    },
  };

  it('renders separate residential and generic proxy buckets from aggregate evidence', () => {
    const html = renderToStaticMarkup(<ProtectedRouteProofSection proof={proof} />);
    expect(html).toContain('RESIDENTIAL');
    expect(html).toContain('PROXIED（通用代理）');
    expect(html).toContain('已观察到独立 RESIDENTIAL 路由');
    expect(html).toContain('观察总数 8');
  });

  it('states no evidence and legacy inconclusive evidence without guessing residential use', () => {
    expect(renderToStaticMarkup(<ProtectedRouteProofSection proof={null} />)).toContain('无证据：尚未收到');
    const legacy = {
      ...proof,
      evidence: {
        ...proof.evidence,
        verdict: 'inconclusive' as const,
        residentialReported: false,
        routes: { ...proof.evidence.routes, residential: 0, proxied: 7 },
      },
    };
    const html = renderToStaticMarkup(<ProtectedRouteProofSection proof={legacy} />);
    expect(html).toContain('证据不完整：旧版快照没有独立 RESIDENTIAL 计数');
    expect(html).toContain('未单列');
  });

  it('labels periodic Windows evidence and keeps unknown routes visible', () => {
    const telemetry = {
      ...proof,
      source: 'periodic_telemetry' as const,
      evidence: {
        ...proof.evidence,
        verdict: 'inconclusive' as const,
        protectedDNSConfigured: null,
        routes: { ...proof.evidence.routes, unknown: 2 },
        exitIdentityConsistency: 'INCONCLUSIVE' as const,
        physicalBypassProbe: 'INCONCLUSIVE' as const,
      },
    };
    const html = renderToStaticMarkup(<ProtectedRouteProofSection proof={telemetry} />);
    expect(html).toContain('Windows 周期遥测');
    expect(html).toContain('UNKNOWN');
    expect(html).toContain('>2<');
    expect(html).toContain('DNS 未上报');
  });
});
