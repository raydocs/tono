import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { copy } from '@/copy/copy';
import { Checklist } from './OnboardDrawer';

describe('onboard checklist', () => {
  it('only says the plan and expiry were kept when the onboard sent one', () => {
    const outcome = {
      email: 'pending@example.com', userId: null, allowlisted: true, exitIdentityIssued: false,
      boundHome: false, hasAccount: false, incomplete: ['user_not_registered'],
    };
    expect(renderToString(<Checklist outcome={outcome} sentEntitlement={false} />))
      .not.toContain(copy.onboardEntitlementKept);
    expect(renderToString(<Checklist outcome={outcome} sentEntitlement />))
      .toContain(copy.onboardEntitlementKept);
  });
});
