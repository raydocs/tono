import type { Measured as ContractMeasured, SourceId } from '@contract';
import type { Measured } from '@/components/ops/measured';
import { copy } from '@/copy/copy';

export function sourceWord(id: SourceId): string {
  return copy.sourceWord[id];
}

/**
 * A contract `Measured<T>` in the form the ops primitives render.
 *
 * The one thing it does beyond renaming the source: a cell whose `asOfSec` is
 * null becomes `value: null`, so `Value` prints the em dash. Without that, a
 * customer whose client has never reported would render `连接: 否` — a
 * confident answer to a question nobody asked the client.
 */
export function shown<T>(measured: ContractMeasured<T>): Measured<T | null> {
  return {
    value: measured.asOfSec === null ? null : measured.value,
    asOfSec: measured.asOfSec,
    source: sourceWord(measured.source),
  };
}
