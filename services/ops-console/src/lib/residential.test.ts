import { describe, expect, it } from 'vitest';
import type { HomeLineDto } from '@contract';
import { exitState, rentByCurrency } from './residential';
import type { HomeExit } from './settings-legacy';

const exit = (patch: Partial<HomeExit>): HomeExit => ({
  id: 'x',
  proxyName: 'x',
  displayName: 'x',
  egressIpv4: null,
  kind: 'socks5',
  socks5Host: null,
  socks5Port: null,
  status: 'active',
  notes: null,
  bindCount: 0,
  lastProbedAt: null,
  probeStatus: null,
  probeAlive: null,
  probeTotal: null,
  updatedAt: 0,
  ...patch,
});

const line = (patch: Partial<HomeLineDto>): HomeLineDto => ({
  id: 'l',
  proxyName: 'l',
  displayName: 'l',
  status: 'active',
  isp: null,
  region: null,
  providerAccountId: null,
  price: null,
  currency: null,
  billingKind: null,
  bundleBytes: null,
  cycleStart: null,
  cycleEnd: null,
  expiresAt: null,
  meterSource: null,
  usage: { value: null, asOfSec: null, source: 'manual' },
  probe: { value: null, asOfSec: null, source: 'collector' },
  boundUsers: { value: 0, asOfSec: null, source: 'manual' },
  notes: null,
  createdAt: 0,
  updatedAt: 0,
  ...patch,
});

describe('residential folds', () => {
  it('calls a line dead before busy, and an unprobed line idle rather than dead', () => {
    expect([
      exitState(exit({ probeAlive: 0, probeTotal: 12 }), 2),
      exitState(exit({ status: 'disabled', probeAlive: 0, probeTotal: 12 }), 0),
      exitState(exit({}), 0),
      exitState(exit({ probeAlive: 3, probeTotal: 4 }), 1),
    ]).toEqual(['dead', 'off', 'idle', 'bound']);
  });

  it('adds up fixed rents per currency and leaves per-GB prices and retired lines out', () => {
    expect(rentByCurrency([
      line({ price: 120, currency: 'CNY', billingKind: 'bundle' }),
      line({ price: 99, currency: 'CNY', billingKind: 'monthly' }),
      line({ price: 15, currency: 'USD', billingKind: 'per_gb' }),
      line({ price: 80, currency: 'CNY', billingKind: 'monthly', status: 'retired' }),
      line({ price: 5, currency: 'USD', billingKind: 'monthly' }),
    ])).toEqual([{ currency: 'CNY', amount: 219 }, { currency: 'USD', amount: 5 }]);
  });
});
