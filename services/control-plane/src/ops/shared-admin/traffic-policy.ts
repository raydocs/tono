import {
  encryptTrafficPolicy,
  sha256,
  TRAFFIC_POLICY_SIGNATURE_CONTEXT,
  verifyTrafficPolicySignature,
} from '../../crypto';
import { ApiError } from '../../errors';
import {
  type Env,
  type Row,
  now,
  requiredCatalogKey,
} from '../../env';
import {
  writeOpsAudit,
} from '../../product-account';
import {
  canonicalTrafficPolicy,
  publicTrafficPolicy,
} from '../../traffic-policy';
import { rejectUnexpectedKeys, body } from '../../request';

export async function trafficPolicyResource(
  req: Request,
  e: Env,
  resource: string,
  m: string,
  actorEmail: string | undefined,
): Promise<Response | null> {
  if (resource === 'traffic-policy' && m === 'GET') {
    return Response.json(await publicTrafficPolicy(e));
  }
  if (resource === 'traffic-policy' && m === 'PUT') {
    const b = await body(req, 64 * 1024);
    rejectUnexpectedKeys(b, ['policy', 'expectedRevision', 'signature', 'dryRun']);
    if (b.signature !== undefined && (typeof b.signature !== 'string' || !b.signature.length || b.signature.length > 128)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid signature');
    }
    if (b.dryRun !== undefined && typeof b.dryRun !== 'boolean') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid dryRun');
    }
    const signature = b.signature as string | undefined;
    const dryRun = b.dryRun === true;
    const policy = canonicalTrafficPolicy(b.policy, dryRun || Boolean(signature));
    const json = JSON.stringify(policy);
    if (signature) {
      const publicKey = e.TRAFFIC_POLICY_PUBLIC_KEY;
      if (!publicKey) {
        throw new ApiError(409, 'TRAFFIC_POLICY_KEY_UNCONFIGURED', 'This deployment has no policy signing public key, so a signed policy cannot be accepted');
      }
      if (!await verifyTrafficPolicySignature(json, signature, publicKey)) {
        throw new ApiError(400, 'TRAFFIC_POLICY_SIGNATURE_INVALID', 'The signature does not cover the canonical policy this would serve');
      }
    }
    if (dryRun) {
      let signatureRequired = false;
      try {
        canonicalTrafficPolicy(b.policy, false);
      } catch {
        signatureRequired = true;
      }
      return Response.json({
        dryRun: true,
        json,
        sha256: await sha256(json),
        signatureRequired,
        signatureContext: TRAFFIC_POLICY_SIGNATURE_CONTEXT,
      });
    }
    const expectedRevision = b.expectedRevision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'expectedRevision is required and must be a non-negative integer');
    }
    const current = await e.DB.prepare(
      'SELECT revision FROM managed_traffic_policy WHERE singleton_id = 1',
    ).first<Row>();
    const currentRevision = Number(current?.revision ?? 0);
    if (expectedRevision !== currentRevision) {
      throw new ApiError(409, 'TRAFFIC_POLICY_CONFLICT', 'Managed traffic policy changed; reload before replacing it');
    }
    const revision = currentRevision + 1;
    const encrypted = await encryptTrafficPolicy(json, requiredCatalogKey(e));
    const digest = await sha256(json);
    const t = now();
    const storedSignature = signature ?? null;
    const changed = current
      ? await e.DB.prepare(
        `UPDATE managed_traffic_policy
         SET revision = ?, ciphertext = ?, nonce = ?, content_sha256 = ?, updated_at = ?, signature = ?
         WHERE singleton_id = 1 AND revision = ?`,
      ).bind(revision, encrypted.ciphertext, encrypted.nonce, digest, t, storedSignature, currentRevision).run()
      : await e.DB.prepare(
        `INSERT OR IGNORE INTO managed_traffic_policy(
           singleton_id, revision, ciphertext, nonce, content_sha256, updated_at, signature
         ) VALUES(1, ?, ?, ?, ?, ?, ?)`,
      ).bind(revision, encrypted.ciphertext, encrypted.nonce, digest, t, storedSignature).run();
    if (!changed.meta.changes) {
      throw new ApiError(409, 'TRAFFIC_POLICY_CONFLICT', 'Managed traffic policy changed; reload before replacing it');
    }
    await writeOpsAudit(
      e,
      actorEmail,
      'traffic-policy.publish',
      'managed_traffic_policy',
      String(revision),
      `published r${currentRevision} → r${revision} (${digest.slice(0, 16)})`,
    );
    return Response.json({
      revision, json, sha256: digest, updatedAt: t,
      ...(signature ? { signature } : {}),
    });
  }
  return null;
}
