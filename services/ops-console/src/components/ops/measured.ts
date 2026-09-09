export type Measured<T> = {
  value: T;
  asOfSec: number | null;
  source: string;
};

export function measured<T>(value: T, asOfSec: number | null, source: string): Measured<T> {
  return { value, asOfSec, source };
}

export function absent(source: string): Measured<null> {
  return { value: null, asOfSec: null, source };
}

export function isPresent<T>(row: Measured<T | null>): row is Measured<T> {
  return row.value !== null && row.value !== undefined;
}
