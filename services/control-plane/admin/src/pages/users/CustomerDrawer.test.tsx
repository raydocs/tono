import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CustomerNodeSwitches, ProtectedRouteProofSection } from './CustomerDrawer';

describe('customer node switches', () => {
  const history = {
    hops: [
      {
        ts: 1_800_000_000_000,
        from: 'Tokyo · Fuji',
        to: 'Los Angeles · Pacific',
        kind: 'nodeSwitch' as const,
        deviceId: 'dev-1',
      },
      {
        ts: 1_799_999_000_000,
        from: 'Los Angeles · Pacific',
        to: 'Tokyo · Sakura',
        kind: 'connectCatalogFailover' as const,
        deviceId: 'dev-1',
      },
    ],
    last24h: 2,
    last7d: 2,
    uniqueNodes: 3,
    frequent: false,
  };

  it('renders the hop path and whether the user or catalog moved', () => {
    const html = renderToStaticMarkup(<CustomerNodeSwitches history={history} />);
    expect(html).toContain('Tokyo · Fuji');
    expect(html).toContain('Los Angeles · Pacific');
    expect(html).toContain('用户切换');
    expect(html).toContain('自动换城');
    expect(html).not.toContain('容易触发风控');
  });

  it('warns when 24h hops are frequent enough to trip 风控', () => {
    const html = renderToStaticMarkup(
      <CustomerNodeSwitches history={{ ...history, last24h: 4, frequent: true }} />,
    );
    expect(html).toContain('24 小时内切换 4 次');
    expect(html).toContain('容易触发风控');
    expect(html).toContain('频繁 · 24h 4 次');
  });

  it('says the next telemetry window still has to arrive when there are no hops', () => {
    const html = renderToStaticMarkup(
      <CustomerNodeSwitches
        history={{ hops: [], last24h: 0, last7d: 0, uniqueNodes: 0, frequent: false }}
      />,
    );
    expect(html).toContain('还没有节点切换记录');
    expect(html).toContain('每 20 分钟');
  });
});


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
