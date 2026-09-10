import {
  encryptCatalog,
  sha256,
} from '../../crypto';
import { ApiError } from '../../errors';
import {
  managedCatalogYAML,
} from '../../catalog-yaml';
import {
  type Env,
  type Row,
  now,
  requiredCatalogKey,
} from '../../env';
import {
  bumpCatalogRevision,
  publicManagedCatalog,
} from '../../catalog';
import {
  writeOpsAudit,
  recordProductEvent,
  assignedProductForUser,
} from '../../product-account';
import { rejectUnexpectedKeys, body, email } from '../../request';

export async function catalogResource(
  req: Request,
  e: Env,
  resource: string,
  m: string,
  actorEmail: string | undefined,
  deps: {
    enforceUser: (e: Env, userId: string, processNow?: boolean) => Promise<void>;
  },
): Promise<Response | null> {
  let mt: RegExpMatchArray | null;
  mt = resource.match(/^users\/([^/]+)\/close$/);
  if (mt && m === 'POST') {
    if (req.headers.get('content-length') && Number(req.headers.get('content-length')) > 0) {
      const b = await body(req, 4 * 1024);
      rejectUnexpectedKeys(b, ['reason']);
    }
    const user = await e.DB.prepare('SELECT * FROM users WHERE id = ?').bind(mt[1]).first<Row>();
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    const t = now();
    const unbound = await e.DB.prepare(
      'DELETE FROM user_home_bindings WHERE user_id = ?',
    ).bind(mt[1]).run();
    if (unbound.meta.changes) await bumpCatalogRevision(e);
    const assigned = await assignedProductForUser(e, mt[1]);
    if (assigned) {
      await e.DB.prepare(
        `UPDATE product_accounts
         SET status = 'retired', closed_at = ?, close_reason = 'other', updated_at = ?
         WHERE id = ? AND status = 'assigned'`,
      ).bind(t, t, assigned.id).run();
      await recordProductEvent(e, String(assigned.id), mt[1], 'note', 'refund close');
    }
    await e.DB.prepare('DELETE FROM signup_allowlist WHERE email = ?').bind(user.email).run();
    await e.DB.prepare(
      `UPDATE users
       SET status = 'disabled',
           notes = CASE WHEN notes IS NULL OR notes = '' THEN '退款销户' ELSE notes END,
           updated_at = ?
       WHERE id = ?`,
    ).bind(t, mt[1]).run();
    await deps.enforceUser(e, mt[1]);
    await writeOpsAudit(e, actorEmail, 'user.close', 'user', mt[1], `closed ${user.email}`);
    return Response.json({ ok: true, email: String(user.email), status: 'disabled' });
  }
  if (resource === 'signup-allowlist' && m === 'POST') {
    const b = await body(req, 4 * 1024);
    const address = email(b.email);
    const createdAt = now();
    const inserted = await e.DB.prepare(
      'INSERT OR IGNORE INTO signup_allowlist(email, created_at) VALUES(?, ?)',
    ).bind(address, createdAt).run();
    const entry = await e.DB.prepare(
      'SELECT created_at FROM signup_allowlist WHERE email = ?',
    ).bind(address).first<Row>();
    if (inserted.meta.changes === 1) {
      await writeOpsAudit(e, actorEmail, 'allowlist.add', 'signup_allowlist', address, address);
    }
    return Response.json(
      {
        email: address,
        createdAt: Number(entry?.created_at ?? createdAt),
        created: inserted.meta.changes === 1,
      },
      { status: inserted.meta.changes === 1 ? 201 : 200 },
    );
  }
  if (resource === 'exit-catalog' && m === 'GET') {
    return Response.json(await publicManagedCatalog(e));
  }
  if (resource === 'exit-catalog' && m === 'PUT') {
    const b = await body(req, 2 * 1024 * 1024);
    rejectUnexpectedKeys(b, ['yaml', 'expectedRevision']);
    const yaml = managedCatalogYAML(b.yaml);
    const expectedRevision = b.expectedRevision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'expectedRevision is required and must be a non-negative integer');
    }
    const current = await e.DB.prepare(
      'SELECT revision FROM managed_exit_catalog WHERE singleton_id = 1',
    ).first<Row>();
    const currentRevision = Number(current?.revision ?? 0);
    if (expectedRevision !== currentRevision) {
      throw new ApiError(409, 'CATALOG_CONFLICT', 'Managed catalog changed; reload before replacing it');
    }
    const revision = currentRevision + 1;
    const encrypted = await encryptCatalog(yaml, requiredCatalogKey(e));
    const digest = await sha256(yaml);
    const t = now();
    const changed = current
      ? await e.DB.prepare(
        `UPDATE managed_exit_catalog
         SET revision = ?, ciphertext = ?, nonce = ?, content_sha256 = ?, updated_at = ?
         WHERE singleton_id = 1 AND revision = ?`,
      ).bind(revision, encrypted.ciphertext, encrypted.nonce, digest, t, currentRevision).run()
      : await e.DB.prepare(
        `INSERT OR IGNORE INTO managed_exit_catalog(
           singleton_id, revision, ciphertext, nonce, content_sha256, updated_at
         ) VALUES(1, ?, ?, ?, ?, ?)`,
      ).bind(revision, encrypted.ciphertext, encrypted.nonce, digest, t).run();
    if (!changed.meta.changes) {
      throw new ApiError(409, 'CATALOG_CONFLICT', 'Managed catalog changed; reload before replacing it');
    }
    await writeOpsAudit(
      e,
      actorEmail,
      'catalog.publish',
      'managed_exit_catalog',
      String(revision),
      `published r${currentRevision} → r${revision} (${digest.slice(0, 16)})`,
    );
    return Response.json({ revision, sha256: digest, updatedAt: t });
  }
  return null;
}
