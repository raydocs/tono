import { type Env } from '../../env';
import { body } from '../../request';
import {
  liveBoundedText,
  liveQualityNodeNamed,
} from '../live';
import type { OpsRequestCache } from '../cache';
import {
  operationsFleetNodes,
  operationsRetirePreview,
  fleetNodeName,
  retireFleetNode,
} from '../reads';

export async function getOpsFleetNodes(e: Env, opsCache: OpsRequestCache): Promise<Response> {
  return Response.json(await operationsFleetNodes(e, opsCache));
}

export async function getOpsFleetNodeRetirePreview(e: Env, mt: RegExpMatchArray, opsCache: OpsRequestCache): Promise<Response> {
  const { nextYaml: _nextYaml, ...preview } = await operationsRetirePreview(e, fleetNodeName(mt[1]), opsCache);
  return Response.json(preview);
}

export async function getOpsFleetNodeQualityText(e: Env, mt: RegExpMatchArray): Promise<Response> {
  const node = await liveQualityNodeNamed(e, fleetNodeName(mt[1]));
  return Response.json({
    securityCheck: liveBoundedText(node?.securityCheck),
    backtrace: liveBoundedText(node?.backtrace),
  });
}

export async function postOpsFleetNodeRetire(req: Request, e: Env, actor: { email: string }, mt: RegExpMatchArray, opsCache: OpsRequestCache): Promise<Response> {
  const b = await body(req, 8 * 1024);
  return Response.json(await retireFleetNode(e, actor.email, fleetNodeName(mt[1]), b, opsCache));
}
