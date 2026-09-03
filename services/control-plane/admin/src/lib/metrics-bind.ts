export function metricsForRange<T>(requestedKey: string, snapshotKey: string | null, data: T | null | undefined): T | null {
  if (!data || snapshotKey !== requestedKey) return null;
  return data;
}
