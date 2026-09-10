import { type Env } from '../../env';

export async function getOpsSystemVersion(e: Env, deps: { buildSha: (e: Env) => string }): Promise<Response> {
  return Response.json({ system: { service: 'api', version: '0.0.1', buildSha: deps.buildSha(e) } });
}
