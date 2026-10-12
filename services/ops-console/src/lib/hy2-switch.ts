import { send } from './api-customer-actions';

/**
 * The two hy2 auto-switch reads and writes (A18). Not in the typed contract:
 * they are shared-admin resources, like the home binding, so they travel
 * through the same `send` and keep a refusal's status and code.
 *
 * `effective` is what the hub resolved for the account; what a client is
 * finally told also needs that client to have received the backup block.
 */
export type Hy2Override = 'on' | 'off' | null;

export type Hy2AccountSwitch = {
  userId: string;
  internalAccount: boolean;
  override: Hy2Override;
  allAccounts: boolean;
  effective: boolean;
};

export type Hy2GlobalSwitch = {
  allAccounts: boolean;
  updatedAt: number | null;
  internalAccounts: number;
  overrideOn: number;
  overrideOff: number;
};

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid hy2 auto-switch response');
  }
  return value as Record<string, unknown>;
}

function flag(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (typeof value !== 'boolean') throw new Error(`invalid ${key}`);
  return value;
}

function count(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`invalid ${key}`);
  return value as number;
}

export function readHy2Account(value: unknown): Hy2AccountSwitch {
  const row = record(value);
  const override = row.override;
  if (override !== null && override !== 'on' && override !== 'off') throw new Error('invalid override');
  return {
    userId: String(row.userId),
    internalAccount: flag(row, 'internalAccount'),
    override,
    allAccounts: flag(row, 'allAccounts'),
    effective: flag(row, 'effective'),
  };
}

export function readHy2Global(value: unknown): Hy2GlobalSwitch {
  const row = record(value);
  const updatedAt = row.updatedAt;
  return {
    allAccounts: flag(row, 'allAccounts'),
    updatedAt: typeof updatedAt === 'number' && updatedAt > 0 ? updatedAt : null,
    internalAccounts: count(row, 'internalAccounts'),
    overrideOn: count(row, 'overrideOn'),
    overrideOff: count(row, 'overrideOff'),
  };
}

const userPath = (userId: string) => `users/${encodeURIComponent(userId)}/hy2-auto-switch`;

export const hy2SwitchApi = {
  account: (userId: string, signal?: AbortSignal) =>
    send('GET', userPath(userId), undefined, readHy2Account, { signal }),
  setAccount: (userId: string, patch: { internalAccount?: boolean; override?: Hy2Override }) =>
    send('PUT', userPath(userId), patch, readHy2Account),
  global: (signal?: AbortSignal) =>
    send('GET', 'hy2-auto-switch', undefined, readHy2Global, { signal }),
  setGlobal: (allAccounts: boolean) =>
    send('PUT', 'hy2-auto-switch', { allAccounts }, readHy2Global),
};
