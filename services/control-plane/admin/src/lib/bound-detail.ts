/** A detail payload may only be used if it still belongs to the customer on screen. */
export function acceptIfCurrent<T>(requestedId: string | null | undefined, arrivedId: string | null | undefined, data: T): T | null {
  if (!requestedId || !arrivedId || requestedId !== arrivedId) return null;
  return data;
}

export type BoundDetail<T> = T & { userId: string };

export function bindDetail<T extends object>(userId: string, data: T): BoundDetail<T> {
  return { ...data, userId };
}
