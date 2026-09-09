import { describe, expect, it } from 'vitest';
import { NODE_VERDICTS, VERDICT_LABELS, type NodeVerdict } from '../src/ops/verdict';

describe('ops verdict labels', () => {
  it('gives every NodeVerdict a Chinese operator label', () => {
    for (const verdict of NODE_VERDICTS) {
      const label: string = VERDICT_LABELS[verdict as NodeVerdict];
      expect(label, `missing label for ${verdict}`).toBeTruthy();
      expect(label).toMatch(/[\u4e00-\u9fff]/);
    }
    expect(Object.keys(VERDICT_LABELS).sort()).toEqual([...NODE_VERDICTS].sort());
  });

  it('keeps down/blocked/ok copy identical to today\'s server labels', () => {
    expect(VERDICT_LABELS.down).toBe('整机失联');
    expect(VERDICT_LABELS.blocked).toBe('疑似被墙');
    expect(VERDICT_LABELS.ok).toBe('大陆正常');
  });
});
