// Raw-log access windows on the customer 360 (plan §4 4.5).
// Split from customers.ts so that file stays under the 500-line ops budget.

import { fields, int, optText, text } from './checkers';

export interface LogWindowDto {
  id: string;
  openedBy: string | null;
  openedAt: number;
  expiresAt: number;
  reads: number;
}

const LOG_WINDOW_KEYS = ['id', 'openedBy', 'openedAt', 'expiresAt', 'reads'];

export function assertLogWindow(value: unknown, path = 'logWindow'): LogWindowDto {
  const row = fields(value, path, LOG_WINDOW_KEYS);
  return {
    id: text(row, path, 'id'),
    openedBy: optText(row, path, 'openedBy'),
    openedAt: int(row, path, 'openedAt'),
    expiresAt: int(row, path, 'expiresAt'),
    reads: int(row, path, 'reads'),
  };
}
