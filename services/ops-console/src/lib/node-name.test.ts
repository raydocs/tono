import { describe, expect, it } from 'vitest';
import { nodeCity, splitNodeName, withoutRemark } from './node-name';

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

describe('nodeCity', () => {
  it('is the first segment of a two-, three- or four-part name', () => {
    expect(nodeCity('Tokyo · Fuji')).toBe('Tokyo');
    expect(nodeCity('Frankfurt · Main · eu-central-1a')).toBe('Frankfurt');
    expect(nodeCity('Frankfurt · Main · eu-central-1a-secondary · 法兰克福备用出口')).toBe('Frankfurt');
  });

  it('is null for a single-part name, and ignores a separator inside parentheses', () => {
    expect(nodeCity('Catalog Only')).toBeNull();
    expect(nodeCity('Harbour（remark · two）')).toBeNull();
    expect(nodeCity('Singapore · Harbour（a · b）')).toBe('Singapore');
    expect(nodeCity('  Tokyo · Fuji ')).toBe('Tokyo');
  });
});
