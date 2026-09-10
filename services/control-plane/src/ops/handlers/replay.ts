import { ApiError } from '../../errors';
import { body, rejectUnexpectedKeys } from '../../request';
import { assertReplay, type ReplayDto } from '../contract';
import { replay } from '../replay';
import { Env, check, jsonNoStore, now } from './common';

function asUnix(value: unknown, label: string, required: boolean): number | null {
  if (value === undefined || value === null) {
    if (required) throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${label}`);
    return null;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${label}`);
  }
  return value;
}

export async function postReplay(req: Request, e: Env): Promise<Response> {
  const b = await body(req, 4 * 1024);
  rejectUnexpectedKeys(b, ['since', 'until', 'node']);
  const since = asUnix(b.since, 'since', true);
  if (since == null) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid since');
  const until = asUnix(b.until, 'until', false) ?? now();
  let node: string | undefined;
  if (b.node !== undefined && b.node !== null) {
    if (typeof b.node !== 'string' || b.node.length < 1 || b.node.length > 200) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid node');
    }
    node = b.node;
  }
  const dto: ReplayDto = await replay(e.DB, { since, until, node }, now());
  check(e, () => { assertReplay(dto); });
  return jsonNoStore(dto);
}
