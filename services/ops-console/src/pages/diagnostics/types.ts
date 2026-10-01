/** Local shapes for the diagnostics reads. Kept beside the panel so the
 *  panel can move without the rest of the console's contract. */

export type FailureCluster = {
  id: string;
  code: string;
  stage: string;
  appVersion: string;
  platform: string;
  node: string;
  count: number;
  users: number;
  devices: number;
  firstSeenMs: number;
  lastSeenMs: number;
  status: string;
  sample: string | null;
  detailPath: string;
};

export type FailureClusterList = {
  clusters: FailureCluster[];
  updatedAt: number;
};

export type DiagnosticsSession = {
  id: string;
  deviceId: string;
  node: string | null;
  bytesUp: number | null;
  bytesDown: number | null;
  outcome: string | null;
  appVersion: string | null;
};

export type CustomerDiagnostics = {
  userId: string;
  sessions: DiagnosticsSession[];
  hops: Array<{ sessionId: string; role: string; connected: boolean; failureCode: string | null }>;
  dnsChecks: Array<{ sessionId: string; leakOutside: boolean; ipv6Leak: boolean }>;
  updatedAt: number;
};
