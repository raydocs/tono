import { assertFunnel } from '../contract';
import { loadFunnel } from '../funnel';
import { type Env, entityJson, now, weakEtag } from './common';

export async function getFunnel(req: Request, e: Env): Promise<Response> {
  const t = now();
  const dto = await loadFunnel(e.DB, t);
  return entityJson(
    e, req, dto,
    weakEtag([dto.updatedAt, dto.items.length, ...dto.stages.map((row) => row.count)]),
    assertFunnel,
  );
}
