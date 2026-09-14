import { describe, expect, it, vi } from 'vitest';
import { reloadAfterFailuresNodeChange } from './failures-reload';

describe('Failures NodeDrawer onChanged', () => {
  it('reloads profiles so billing confirmation can update', () => {
    const live = { reload: vi.fn() };
    const profiles = { reload: vi.fn() };
    const fleet = { reload: vi.fn() };
    reloadAfterFailuresNodeChange({ live, profiles });
    expect(profiles.reload).toHaveBeenCalledTimes(1);
    expect(live.reload).toHaveBeenCalledTimes(1);
    expect(fleet.reload).not.toHaveBeenCalled();
  });
});
