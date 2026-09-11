import { ApiError } from '../../errors';
import { assertChangeReceipt, type ChangeReceiptDto } from '../contract';
import { receiptDto } from '../change-receipts';
import { requireNode } from './nodes-data';
import {
  type Env,
  type Row,
  afterCursor,
  decodeName,
  encodeCursor,
  listJson,
  missingTable,
  now,
  pageParams,
  weakEtag,
} from './common';

export async function getNodeReceipts(
  req: Request,
  e: Env,
  rawName: string,
): Promise<Response> {
  const name = decodeName(rawName);
  await requireNode(e, name);
  const url = new URL(req.url);
  const { cursor, limit } = pageParams(url);

  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare(
      `SELECT * FROM ops_change_receipts
       WHERE subject_type = 'node' AND subject_id = ?
       ORDER BY at DESC, id DESC
       LIMIT 500`,
    ).bind(name).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }

  const items: ChangeReceiptDto[] = rows.map(receiptDto);
  const filtered = items.filter((row) => afterCursor(cursor, String(row.at), row.id, 'desc'));
  const page = filtered.slice(0, limit + 1);
  const sliced = page.length > limit ? page.slice(0, limit) : page;
  const last = sliced[sliced.length - 1];
  const nextCursor = page.length > limit && last ? encodeCursor(String(last.at), last.id) : null;
  const updatedAt = sliced[0]?.at ?? now();

  return listJson(
    e,
    req,
    sliced,
    nextCursor,
    updatedAt,
    weakEtag([name, updatedAt, items.length]),
    assertChangeReceipt,
  );
}
