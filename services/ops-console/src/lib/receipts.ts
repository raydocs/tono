import type { ChangeReceiptDto } from '@contract';
import { copy } from '@/copy/copy';

function extractRev(obj: unknown): number | null {
  if (obj && typeof obj === 'object' && 'revision' in obj) {
    const rev = (obj as Record<string, unknown>).revision;
    if (typeof rev === 'number' && Number.isFinite(rev)) return rev;
  }
  return null;
}

export function receiptRevText(receipt: ChangeReceiptDto): string | null {
  const beforeRev = extractRev(receipt.before);
  const afterRev = extractRev(receipt.after);
  if (beforeRev !== null && afterRev !== null) {
    return receipt.kind === 'policy_publish'
      ? copy.receiptPolicyRev(beforeRev, afterRev)
      : copy.receiptCatalogRev(beforeRev, afterRev);
  }
  return null;
}

export function receiptAcksText(receipt: ChangeReceiptDto): string | null {
  return receipt.clientAcks > 0 ? copy.receiptClientAcks(receipt.clientAcks) : null;
}

export function receiptSentence(receipt: ChangeReceiptDto): string {
  const action = copy.receiptAction[receipt.kind as keyof typeof copy.receiptAction] ?? receipt.kind;
  const rev = receiptRevText(receipt);
  const acks = receiptAcksText(receipt);
  return copy.receiptSentence(action, rev, acks);
}

export function receiptDetail(receipt: ChangeReceiptDto): string {
  const rev = receiptRevText(receipt);
  const acks = receiptAcksText(receipt);
  return copy.receiptSentence('', rev, acks).replace(/^[ \t·]+/, '');
}
