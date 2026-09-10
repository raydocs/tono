import { afterEach, describe, expect, it, vi } from 'vitest';
import { copy, type PageId } from '@/copy/copy';
import { can } from '@contract';
import { currentRole, firstAllowedPage, PAGE_REQUIRES, visiblePages } from './roles';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ops console roles', () => {
  it('owner sees all pages, operator sees settings, viewer does not', () => {
    const pages = Object.keys(copy.pages) as PageId[];
    expect(visiblePages('owner')).toEqual(pages);
    expect(visiblePages('operator')).toEqual(pages);
    expect(visiblePages('viewer')).toEqual(pages.filter((id) => id !== 'settings'));
    expect(firstAllowedPage('viewer')).toBe('today');
  });

  it('every page names an action the table knows', () => {
    for (const id of Object.keys(copy.pages) as PageId[]) {
      expect(can(PAGE_REQUIRES[id], 'owner'), id).toBe(true);
    }
  });

  it('currentRole defaults to owner on garbage and reads VITE_OPS_ROLE lazily', () => {
    expect(currentRole()).toBe('owner');
    vi.stubEnv('VITE_OPS_ROLE', 'garbage');
    expect(currentRole()).toBe('owner');
    vi.stubEnv('VITE_OPS_ROLE', 'viewer');
    expect(currentRole()).toBe('viewer');
  });
});
