import { describe, expect, it } from 'vitest';
import source from '../src/index.ts?raw';
import limitText from './index-size.txt?raw';

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}

describe('src/index.ts size ratchet', () => {
  it('index.ts may only shrink — move code into src/ops', () => {
    const limit = Number(limitText.trim());
    const lines = lineCount(source);
    expect(lines, 'index.ts may only shrink — move code into src/ops').toBeLessThanOrEqual(limit);
  });
});
