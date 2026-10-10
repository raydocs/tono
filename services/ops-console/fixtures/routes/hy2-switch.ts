import type { IncomingMessage, ServerResponse } from 'node:http';
import { nowSec } from '../../src/lib/clock';
import { readBody, refuse, sendJson } from './customers-store';

/**
 * hy2 auto-switch (A18), served by the fixture dev server: the global switch
 * in 设置 and the per-account card on a customer page, one mutable store per
 * `?session=`. The resolution order is the hub's (`src/hy2-auto-switch.ts` in
 * the control plane): a per-account override wins, then the global switch,
 * then the internal mark. Unknown accounts read as default, which is what a
 * fresh account in the hub looks like.
 */
type Account = { internalAccount: boolean; override: 'on' | 'off' | null };
type State = { allAccounts: boolean; updatedAt: number; accounts: Map<string, Account> };

export function createHy2SwitchFixtures() {
  const states = new Map<string, State>();

  function stateFor(session: string): State {
    const found = states.get(session);
    if (found) return found;
    const made: State = { allAccounts: false, updatedAt: 0, accounts: new Map() };
    states.set(session, made);
    return made;
  }

  function accountView(state: State, userId: string) {
    const account = state.accounts.get(userId) ?? { internalAccount: false, override: null };
    const effective = account.override === 'off'
      ? false
      : account.override === 'on' || state.allAccounts || account.internalAccount;
    return { userId, ...account, allAccounts: state.allAccounts, effective };
  }

  function globalView(state: State) {
    const accounts = [...state.accounts.values()];
    return {
      allAccounts: state.allAccounts,
      updatedAt: state.updatedAt || null,
      internalAccounts: accounts.filter((row) => row.internalAccount).length,
      overrideOn: accounts.filter((row) => row.override === 'on').length,
      overrideOff: accounts.filter((row) => row.override === 'off').length,
    };
  }

  return function hy2SwitchFixtures(options: {
    req: IncomingMessage;
    res: ServerResponse;
    route: string;
    session: string;
  }): boolean {
    const { req, res } = options;
    const parts = options.route.split('/').map(decodeURIComponent);
    const method = req.method ?? 'GET';
    const state = stateFor(options.session);
    if (parts.length === 1 && parts[0] === 'hy2-auto-switch') {
      if (method === 'GET') {
        sendJson(res, globalView(state));
        return true;
      }
      if (method !== 'PUT') return false;
      void readBody(req).then((body) => {
        if (typeof body.allAccounts !== 'boolean') {
          refuse(res, 400, 'VALIDATION_ERROR', 'allAccounts must be a boolean');
          return;
        }
        if (state.allAccounts !== body.allAccounts) state.updatedAt = nowSec();
        state.allAccounts = body.allAccounts;
        sendJson(res, globalView(state));
      });
      return true;
    }
    if (parts.length !== 3 || parts[0] !== 'users' || parts[2] !== 'hy2-auto-switch') return false;
    const userId = parts[1] ?? '';
    if (method === 'GET') {
      sendJson(res, accountView(state, userId));
      return true;
    }
    if (method !== 'PUT') return false;
    void readBody(req).then((body) => {
      const current = state.accounts.get(userId) ?? { internalAccount: false, override: null };
      const override = body.override;
      if (override !== undefined && override !== null && override !== 'on' && override !== 'off') {
        refuse(res, 400, 'VALIDATION_ERROR', 'override must be on, off or null');
        return;
      }
      state.accounts.set(userId, {
        internalAccount: typeof body.internalAccount === 'boolean' ? body.internalAccount : current.internalAccount,
        override: override === undefined ? current.override : override,
      });
      sendJson(res, accountView(state, userId));
    });
    return true;
  };
}
