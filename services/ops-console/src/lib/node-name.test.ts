import { describe, expect, it } from 'vitest';
import { splitNodeName, withoutRemark } from './node-name';

describe('splitNodeName', () => {
  it('splits on the last separator outside full-width parentheses and trims', () => {
    expect(splitNodeName('Tokyo · Fuji')).toEqual({ prefix: 'Tokyo', main: 'Fuji' });
    expect(splitNodeName('Los Angeles · Mesa')).toEqual({ prefix: 'Los Angeles', main: 'Mesa' });
    expect(splitNodeName('Los Angeles · Pacific-Coast-Highway-Backhaul-01')).toEqual({
      prefix: 'Los Angeles',
      main: 'Pacific-Coast-Highway-Backhaul-01',
    });
    expect(splitNodeName('Singapore · Harbour（新加坡海港 · 大陆直连 · CMIN2）')).toEqual({
      prefix: 'Singapore',
      main: 'Harbour（新加坡海港 · 大陆直连 · CMIN2）',
    });
    expect(splitNodeName('Catalog Only')).toEqual({ prefix: null, main: 'Catalog Only' });
    expect(splitNodeName('  Tokyo · Fuji  ')).toEqual({ prefix: 'Tokyo', main: 'Fuji' });
  });
});

describe('withoutRemark', () => {
  it('drops a trailing full-width parenthetical and keeps everything else', () => {
    expect(withoutRemark('Harbour（remark · two）')).toBe('Harbour');
    expect(withoutRemark('Harbour（a（b）c）')).toBe('Harbour');
    expect(withoutRemark('Harbour （remark） ')).toBe('Harbour');
    expect(withoutRemark('Harbour-01')).toBe('Harbour-01');
    expect(withoutRemark('Mid（x）dle')).toBe('Mid（x）dle');
  });

  it('never leaves the line empty', () => {
    expect(withoutRemark('（only a remark）')).toBe('（only a remark）');
    expect(withoutRemark('remark）')).toBe('remark）');
  });
});
