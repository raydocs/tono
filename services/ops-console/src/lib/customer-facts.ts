import type { CustomerSummaryDto } from '@contract';
import { fromDateInput } from './settings';

/**
 * Hand-kept facts that are missing across the customer list.
 *
 * The expiry is written only by this console, so on a fleet where nobody has
 * typed one the whole column is dashes. A customer is "missing" it when they
 * are in use (not suspended, not already lapsed) and have no date at all;
 * someone who was switched off is not waiting for a date to be entered.
 */
export type CustomerGaps = {
  /** Ids of in-use customers with no expiry date entered. */
  noExpiry: string[];
};

export const isInUse = (row: CustomerSummaryDto): boolean => row.lifecycle === 'active';

export function customerFactsGaps(rows: readonly CustomerSummaryDto[]): CustomerGaps {
  return {
    noExpiry: rows.filter((row) => isInUse(row) && row.expiresAt === null).map((row) => row.userId),
  };
}

/**
 * The patch every picked customer gets when one date is typed for all of them,
 * or null while the text is not a date strictly after now.
 *
 * A date already past would revoke every picked customer's devices within
 * minutes, and the batch has no per-person look at the result before it goes,
 * so unlike the single-customer drawer it only takes the future.
 */
export function absoluteExpiryPatch(typed: string, now: number): { expiresAt: number } | null {
  const seconds = fromDateInput(typed);
  return seconds === null || seconds <= now ? null : { expiresAt: seconds };
}
