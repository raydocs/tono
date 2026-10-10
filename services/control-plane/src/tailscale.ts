// Tailscale API access: OAuth token, authenticated calls and resolving an
// enrolling device from the tailnet inventory. Moved verbatim from
// index.ts; this module never imports index.ts back.

import { ApiError } from './errors';
import { type Env, type Row, str, requiredSecret } from './env';

// --- Tailscale ----------------------------------------------------------------

export async function tailscaleToken(e: Env) {
  const r = await fetch('https://api.tailscale.com/api/v2/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: e.TAILSCALE_OAUTH_CLIENT_ID,
      client_secret: requiredSecret(e.TAILSCALE_OAUTH_CLIENT_SECRET),
      grant_type: 'client_credentials',
      // Explicitly downscope every generated access token. The credential is
      // configured with a grantless controller tag that owns only the pending
      // and active client tags in the repository policy artifact.
      scope: 'auth_keys devices:core',
      tags: 'tag:tono-controller',
    }).toString(),
  });
  if (!r.ok) {
    await r.body?.cancel();
    throw new ApiError(502, 'TAILSCALE_ERROR', 'Tailscale authentication failed');
  }
  const accessToken = (await r.json() as Row).access_token;
  if (
    typeof accessToken !== 'string' ||
    accessToken.length < 8 ||
    accessToken.length > 4_096 ||
    /\s/.test(accessToken)
  ) {
    throw new ApiError(502, 'TAILSCALE_ERROR', 'Tailscale authentication failed');
  }
  return accessToken;
}

export async function tailscale(
  e: Env,
  path: string,
  init: RequestInit = {},
  allowNotFound = false,
  accessToken?: string,
) {
  const r = await fetch(`https://api.tailscale.com/api/v2${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${accessToken ?? await tailscaleToken(e)}` },
  });
  if (!r.ok && !(allowNotFound && r.status === 404)) {
    await r.body?.cancel();
    throw new ApiError(502, 'TAILSCALE_ERROR', 'Tailscale API request failed');
  }
  return r;
}

export interface ResolvedTailscaleDevice {
  managementId: string;
  apiNodeId?: string;
  publicKey?: string;
  addresses: string[];
}

export function normalizedNodeKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith('nodekey:') ? trimmed.slice('nodekey:'.length) : trimmed;
}

/**
 * Resolve a pending Tailscale node from tailnet inventory.
 * NEVER use client-submitted IDs as GET /device/{id} path segments.
 * Management API `id` is used only for /device/{id}/tags and DELETE.
 */
export async function resolveFromInventory(
  e: Env,
  opts: {
    stableNodeId: string;
    nodeId?: string;
    publicKey?: string;
    ips: string[];
    enrollmentHostname: string;
  },
): Promise<ResolvedTailscaleDevice> {
  const r = await tailscale(e, `/tailnet/${encodeURIComponent(e.TAILSCALE_TAILNET)}/devices`);
  if (!r.ok) throw new ApiError(502, 'TAILSCALE_ERROR', 'Failed to list tailnet devices');
  const data = await r.json() as Row;
  const inventory: Row[] = Array.isArray(data.devices) ? data.devices : [];

  const candidates = inventory.filter((td) => {
    const tags: string[] = Array.isArray(td.tags) ? td.tags.map(String) : [];
    const addresses: string[] = Array.isArray(td.addresses) ? td.addresses.map(String) : [];
    const hostnameLabels = [td.name, td.hostname, td.hostName, td.dnsName, td.DNSName]
      .filter((value) => typeof value === 'string')
      .map((value) => String(value).trim().toLowerCase().replace(/\.$/, '').split('.')[0]);
    return tags.includes('tag:pending-tunnel-client') &&
      hostnameLabels.includes(opts.enrollmentHostname) &&
      sameAddressSet(addresses, opts.ips);
  });

  if (candidates.length === 0) {
    throw new ApiError(
      400,
      'INVALID_TAILSCALE_NODE',
      'No pending Tailscale node matches this enrollment and the submitted addresses',
    );
  }

  let narrowed = candidates;
  let hasServerVerifiedIdentity = false;

  if (opts.nodeId) {
    narrowed = narrowed.filter((td) => String(td.nodeId ?? '') === opts.nodeId);
    if (narrowed.length === 0) {
      throw new ApiError(400, 'INVALID_TAILSCALE_NODE', 'Submitted nodeId does not match pending inventory');
    }
    hasServerVerifiedIdentity = true;
  }
  if (opts.publicKey) {
    const submittedKey = normalizedNodeKey(opts.publicKey);
    narrowed = narrowed.filter((td) => {
      const fields = [td.publicKey, td.key, td.nodeKey]
        .map(normalizedNodeKey)
        .filter((x): x is string => x !== undefined);
      return submittedKey !== undefined && fields.includes(submittedKey);
    });
    if (narrowed.length === 0) {
      throw new ApiError(400, 'INVALID_TAILSCALE_NODE', 'Submitted publicKey does not match pending inventory');
    }
    hasServerVerifiedIdentity = true;
  }

  // Some Device API versions expose StableNodeID explicitly. If present, it must
  // agree exactly; hostnames and management ids are never substitutes.
  const stableFields = (td: Row) =>
    [td.stableNodeId, td.stableNodeID, td.stableId]
      .filter((x) => x != null)
      .map(String);
  const serverExposesStableId = narrowed.some((td) => stableFields(td).length > 0);
  const stableMatches = narrowed.filter((td) => stableFields(td).includes(opts.stableNodeId));
  if (serverExposesStableId) {
    if (stableMatches.length === 0) {
      throw new ApiError(400, 'INVALID_TAILSCALE_NODE', 'Submitted stableNodeId does not match pending inventory');
    }
    narrowed = stableMatches;
    hasServerVerifiedIdentity = true;
  }

  if (!hasServerVerifiedIdentity) {
    throw new ApiError(
      400,
      'UNVERIFIABLE_TAILSCALE_IDENTITY',
      'A server-verifiable nodeId or publicKey is required',
    );
  }
  if (narrowed.length !== 1) {
    throw new ApiError(400, 'INVALID_TAILSCALE_NODE', 'Ambiguous Tailscale node for submitted identity');
  }

  const matched = narrowed[0];
  const managementId = str(matched.id, 'tailscaleDeviceId', 1, 200);
  const apiNodeId = matched.nodeId != null ? String(matched.nodeId) : undefined;
  const publicKey = [matched.publicKey, matched.key, matched.nodeKey]
    .map(normalizedNodeKey)
    .find((x): x is string => x !== undefined);
  const addresses: string[] = Array.isArray(matched.addresses) ? matched.addresses.map(String) : [];
  return { managementId, apiNodeId, publicKey, addresses };
}

/** Multiset equality for Tailscale addresses (order-independent). */
function sameAddressSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].map(String).sort();
  const sb = [...b].map(String).sort();
  return sa.every((x, i) => x === sb[i]);
}
