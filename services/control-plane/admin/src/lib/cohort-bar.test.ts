import { describe, expect, it } from 'vitest';
import { bannerStaleAfterRepopulate, cohortBarVisible } from './cohort-bar';

describe('cohortBarVisible', () => {
  it('mounts when the cohort is non-empty even with no banner', () => {
    expect(cohortBarVisible(3, null, null)).toBe(true);
    expect(cohortBarVisible(1, null, null)).toBe(true);
  });

  it('stays mounted on an empty cohort while a success banner is showing (the all-succeed fix)', () => {
    expect(cohortBarVisible(0, '已给 3 位续 30 天', null)).toBe(true);
    expect(cohortBarVisible(0, '已给 1 位客户的在线设备下发刷新目录', null)).toBe(true);
  });

  it('stays mounted on an empty cohort while an error banner is showing (regression guard for the failure cases)', () => {
    expect(cohortBarVisible(0, null, '3 位没做成：…')).toBe(true);
    expect(cohortBarVisible(0, '已给 2 位续 30 天', '1 位没做成：…')).toBe(true);
  });

  it('unmounts only when the cohort is empty and no banner remains', () => {
    expect(cohortBarVisible(0, null, null)).toBe(false);
  });

  it('never unmounts while there are targets, regardless of banner state', () => {
    for (const ok of [null, '已给 1 位续 30 天'] as const) {
      for (const error of [null, '1 位没做成：…'] as const) {
        expect(cohortBarVisible(5, ok, error)).toBe(true);
      }
    }
  });
});

describe('bannerStaleAfterRepopulate', () => {
  it('retires the banner when a drained bar repopulates (0 -> N)', () => {
    expect(bannerStaleAfterRepopulate(0, 1)).toBe(true);
    expect(bannerStaleAfterRepopulate(0, 2)).toBe(true);
    expect(bannerStaleAfterRepopulate(0, 99)).toBe(true);
  });

  it('does not retire on the batch all-succeed shrinkage (N -> 0)', () => {
    expect(bannerStaleAfterRepopulate(3, 0)).toBe(false);
    expect(bannerStaleAfterRepopulate(1, 0)).toBe(false);
  });

  it('does not retire on a partial outcome (N -> M, both positive)', () => {
    expect(bannerStaleAfterRepopulate(3, 1)).toBe(false);
    expect(bannerStaleAfterRepopulate(5, 2)).toBe(false);
    expect(bannerStaleAfterRepopulate(2, 1)).toBe(false);
  });

  it('does not retire on an all-failure cohort unchanged (N -> N)', () => {
    expect(bannerStaleAfterRepopulate(3, 3)).toBe(false);
    expect(bannerStaleAfterRepopulate(1, 1)).toBe(false);
  });

  it('does not retire while the bar stays drained (0 -> 0)', () => {
    expect(bannerStaleAfterRepopulate(0, 0)).toBe(false);
  });

  it('never retires a banner when the previous cohort was non-empty', () => {
    for (let prev = 1; prev <= 4; prev += 1) {
      for (let next = 0; next <= 5; next += 1) {
        expect(bannerStaleAfterRepopulate(prev, next)).toBe(false);
      }
    }
  });

  it('never retires a banner when the next cohort is empty', () => {
    for (let prev = 0; prev <= 5; prev += 1) {
      expect(bannerStaleAfterRepopulate(prev, 0)).toBe(false);
    }
  });
});

describe('cohort bar banner lifecycle (cross-cutting)', () => {
  // The full end-to-end sequence for a fully successful expiring renewal,
  // expressed as the two predicates the component now composes, to lock in
  // that the bar and its success banner survive the post-batch reload.
  it('keeps the success banner visible across the all-succeed reload, then retires it on the next repopulation', () => {
    let ok: string | null = '已给 3 位续 30 天';
    let error: string | null = null;
    let prev = 3;

    // Batch succeeds, reload empties the cohort: 3 -> 0.
    const targetsAfterReload = 0;
    if (bannerStaleAfterRepopulate(prev, targetsAfterReload)) {
      ok = null;
      error = null;
    }
    prev = targetsAfterReload;
    expect(cohortBarVisible(targetsAfterReload, ok, error)).toBe(true);
    expect(ok).toBe('已给 3 位续 30 天'); // still showing

    // Bar sits drained; operator reads the banner. New customers appear: 0 -> 2.
    const targetsRepopulated = 2;
    if (bannerStaleAfterRepopulate(prev, targetsRepopulated)) {
      ok = null;
      error = null;
    }
    prev = targetsRepopulated;
    expect(cohortBarVisible(targetsRepopulated, ok, error)).toBe(true);
    expect(ok).toBe(null); // stale banner retired
    expect(error).toBe(null);
  });

  it('keeps a partial outcome banner across its reload (3 -> 1) and does not retire it early', () => {
    let ok: string | null = '已给 2 位续 30 天';
    let error: string | null = '1 位没做成：…';
    let prev = 3;

    const targetsAfterReload = 1; // two renewed left, one failure stayed
    if (bannerStaleAfterRepopulate(prev, targetsAfterReload)) {
      ok = null;
      error = null;
    }
    prev = targetsAfterReload;
    expect(cohortBarVisible(targetsAfterReload, ok, error)).toBe(true);
    expect(ok).toBe('已给 2 位续 30 天');
    expect(error).toBe('1 位没做成：…');
  });
});
