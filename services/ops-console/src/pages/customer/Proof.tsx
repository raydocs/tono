import { Empty } from '@/components/ops/Empty';
import { Fact } from '@/components/ops/DetailDrawer';
import { FoldedSection } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { formatWhen } from '@/lib/display';
import { measured } from '@/components/ops/measured';
import type { CustomerAccountDetail, RouteEvidence, RouteProof } from '@/lib/customers-legacy';

/**
 * The two blocks that only answer questions: is this customer's Claude
 * traffic actually leaving through their own line, and what has the client
 * sent back when it was asked.
 *
 * Both are folded because neither is read on a normal day, and both are facts
 * rather than documents. The evidence used to be a wall of counters and the
 * report a pretty-printed blob; a blob is not evidence an operator can act on,
 * and the raw report carries one customer's paths and processes, which has no
 * business sitting open in a browser tab. What is left is the verdict, the
 * counts behind it, and — for a report — what it is and when it came.
 */
export function Proof({
  detail,
  loading,
  message,
}: {
  detail: CustomerAccountDetail | null;
  loading: boolean;
  message: string | null;
}) {
  const proof = detail?.proof ?? null;
  const reports = detail?.diagnostics ?? [];
  return (
    <>
      <FoldedSection title={copy.proofSection}>
        {loading ? <Empty message={copy.loading} /> : null}
        {message === null ? null : <Empty message={message} />}
        {!loading && message === null ? <ProofBody proof={proof} /> : null}
      </FoldedSection>

      <FoldedSection title={copy.customerSections.diagnostics} count={reports.length}>
        {loading ? <Empty message={copy.loading} /> : null}
        {message === null ? null : <Empty message={message} />}
        {!loading && message === null && reports.length === 0 ? (
          <Empty message={copy.noDiagnostics} />
        ) : null}
        {reports.map((report) => (
          <div key={report.referenceCode} className="grid gap-x-8 sm:grid-cols-2">
            <Fact
              label={copy.reportFacts.code}
              measured={measured(report.referenceCode, report.receivedAt, copy.sourceWord.telemetry)}
            />
            <Fact
              label={copy.reportFacts.at}
              measured={measured(formatWhen(report.receivedAt), report.receivedAt, copy.sourceWord.telemetry)}
            />
            <Fact
              label={copy.reportFacts.client}
              measured={measured(report.clientVersion, report.receivedAt, copy.sourceWord.telemetry)}
            />
            <Fact
              label={copy.reportFacts.os}
              measured={measured(report.osVersion, report.receivedAt, copy.sourceWord.telemetry)}
            />
          </div>
        ))}
      </FoldedSection>
    </>
  );
}

function ProofBody({ proof }: { proof: RouteProof | null }) {
  if (proof === null) return <Empty message={copy.proofNone} />;
  const evidence = proof.evidence;
  if (evidence === null) {
    return (
      <Empty
        message={proof.status === 'pending' || proof.status === 'delivered'
          ? copy.proofPending
          : copy.proofThin}
      />
    );
  }
  const at = proof.completedAt;
  const source = copy.proofSource as Record<string, string | undefined>;
  const exits = copy.proofExit as Record<string, string | undefined>;
  const bypass = copy.proofBypass as Record<string, string | undefined>;
  const stamp = (value: string) => measured(value, at, copy.sourceWord.telemetry);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-[var(--muted-foreground)]">{copy.proofVerdict[evidence.verdict]}</p>
      <div className="grid gap-x-8 sm:grid-cols-2">
        <Fact
          label={copy.proofFacts.residential}
          measured={stamp(evidence.residentialReported
            ? copy.proofUnit(evidence.routes.residential)
            : copy.proofResidentialUncounted)}
        />
        <Fact label={copy.proofFacts.observed} measured={stamp(copy.proofUnit(evidence.routes.observed))} />
        <Fact label={copy.proofFacts.proxied} measured={stamp(copy.proofUnit(evidence.routes.proxied))} />
        <Fact label={copy.proofFacts.direct} measured={stamp(copy.proofUnit(evidence.routes.direct))} />
        <Fact label={copy.proofFacts.blocked} measured={stamp(copy.proofUnit(evidence.routes.blocked))} />
        <Fact label={copy.proofFacts.unknown} measured={stamp(copy.proofUnit(evidence.routes.unknown))} />
        <Fact
          label={copy.proofFacts.protectedDirect}
          measured={stamp(copy.proofUnit(evidence.protectedDirectConnectionCount))}
        />
        <Fact
          label={copy.proofFacts.exit}
          measured={stamp(exits[evidence.exitIdentityConsistency] ?? evidence.exitIdentityConsistency)}
        />
        <Fact
          label={copy.proofFacts.bypass}
          measured={stamp(bypass[evidence.physicalBypassProbe] ?? evidence.physicalBypassProbe)}
        />
        <Fact label={copy.proofFacts.protection} measured={stamp(protectionWord(evidence))} />
        <Fact label={copy.proofFacts.source} measured={stamp(source[proof.source] ?? proof.source)} />
        <Fact
          label={copy.proofFacts.at}
          measured={measured(at === null ? null : formatWhen(at), at, copy.sourceWord.telemetry)}
        />
      </div>
    </div>
  );
}

/**
 * Whether the four things that make the protection real were all in place.
 *
 * A client that has not reported its DNS state at all is a third answer, not a
 * failing one: the older builds never sent the field, and reading their
 * silence as "not configured" would put a red word on a machine nobody has
 * looked at.
 */
function protectionWord(evidence: RouteEvidence): string {
  if (evidence.protectedDNSConfigured === null) return copy.proofProtection.unreported;
  const whole = evidence.connected
    && evidence.tunPresent
    && evidence.killSwitchArmed
    && evidence.protectedDNSConfigured;
  return whole ? copy.proofProtection.whole : copy.proofProtection.partial;
}
