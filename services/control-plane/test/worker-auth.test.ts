import {
  env,
} from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { type Env } from '../src/index';
import {
  api,
  json,
  sequence,
  createAccount,
  startEmailSignIn,
  emailSignIn,
  oidcToken,
  nextSequence,
  useWorkerHarness,
} from './worker-harness';

describe('Worker routes with D1 and mocked Tailscale', () => {
  useWorkerHarness();

  it('creates an account directly from a verified email and consumes one code winner atomically', async () => {
    const email = `email-otp-${nextSequence()}@example.com`;
    const started = await startEmailSignIn({
      email,
      deviceName: 'Primary Mac',
      installationId: 'email-otp-installation',
    });
    expect(started.response.status).toBe(202);
    expect(started.code).toMatch(/^\d{6}$/);

    const stored = await env.DB.prepare(
      'SELECT secret_hash, consumed_at FROM auth_challenges WHERE id = ?',
    ).bind(started.challengeId).first<any>();
    expect(stored.secret_hash).not.toContain(started.code);
    expect(stored.consumed_at).toBeNull();

    const attempts = await Promise.all([
      api('auth/email/verify', json({ challengeId: started.challengeId, code: started.code })),
      api('auth/email/verify', json({ challengeId: started.challengeId, code: started.code })),
    ]);
    expect(attempts.map((response) => response.status).sort()).toEqual([200, 401]);
    expect((await api('auth/email/verify', json({
      challengeId: started.challengeId,
      code: started.code,
    }))).status).toBe(401);

    const identity = await env.DB.prepare(
      "SELECT provider, subject FROM auth_identities WHERE provider = 'email'",
    ).first<any>();
    expect(identity).toEqual({ provider: 'email', subject: email });

    const secondEmail = `direct-${sequence}@example.com`;
    const direct = await emailSignIn({
      email: secondEmail,
      deviceName: 'Direct Mac',
      installationId: 'direct-email-installation',
    });
    expect(direct.status).toBe(200);
    expect((await direct.json() as any).user.email).toBe(secondEmail);

    const outsideAllowlist = await startEmailSignIn({
      email: `outside-${sequence}@unauthorized.invalid`,
      deviceName: 'Unknown Mac',
      installationId: 'outside-allowlist-installation',
    });
    expect(outsideAllowlist.response.status).toBe(202);
    expect(outsideAllowlist.code).toBeUndefined();
  });

  it('verifies Google OIDC signature, audience, nonce, direct signup, and replay protection', async () => {
    const email = `google-${nextSequence()}@example.com`;
    const challengeResponse = await api('auth/oidc/challenge', json({
      provider: 'google',
      deviceName: 'Google Mac',
      installationId: 'google-installation',
    }));
    expect(challengeResponse.status).toBe(200);
    const challenge = await challengeResponse.json() as any;
    const stored = await env.DB.prepare(
      'SELECT secret_hash FROM auth_challenges WHERE id = ?',
    ).bind(challenge.challengeId).first<any>();
    expect(stored.secret_hash).not.toBe(challenge.nonce);

    const wrongAudience = await oidcToken('google', challenge.nonce, {
      subject: 'google-user-1',
      email,
      audience: 'attacker-client.example',
    });
    expect((await api('auth/oidc/verify', json({
      provider: 'google',
      challengeId: challenge.challengeId,
      idToken: wrongAudience,
    }))).status).toBe(401);

    const validToken = await oidcToken('google', challenge.nonce, {
      subject: 'google-user-1',
      email,
      hd: 'example.com',
    });
    const verified = await api('auth/oidc/verify', json({
      provider: 'google',
      challengeId: challenge.challengeId,
      idToken: validToken,
    }));
    expect(verified.status).toBe(200);
    expect((await verified.json() as any).user.email).toBe(email);
    expect((await api('auth/oidc/verify', json({
      provider: 'google',
      challengeId: challenge.challengeId,
      idToken: validToken,
    }))).status).toBe(401);

    const identity = await env.DB.prepare(
      "SELECT user_id, email FROM auth_identities WHERE provider = 'google' AND subject = ?",
    ).bind('google-user-1').first<any>();
    expect(identity.email).toBe(email);
  });

  it('lets Google link an existing account only when Google is authoritative for the mailbox (#789)', async () => {
    const googleVerify = async (subject: string, email: string, hd?: string) => {
      const challengeResponse = await api('auth/oidc/challenge', json({
        provider: 'google', deviceName: 'Google Mac', installationId: `google-link-${subject}`,
      }));
      const challenge = await challengeResponse.json() as any;
      const idToken = await oidcToken('google', challenge.nonce, { subject, email, hd });
      return api('auth/oidc/verify', json({ provider: 'google', challengeId: challenge.challengeId, idToken }));
    };
    const linkedSubjects = async (email: string) => (await env.DB.prepare(
      "SELECT subject FROM auth_identities WHERE provider = 'google' AND email = ?",
    ).bind(email).all<any>()).results.map((row) => row.subject);

    // An email-code account at an unmanaged address: a Google claim without hd
    // (or with a foreign hd) cannot take it over, and nothing is linked.
    const external = await createAccount('google-external');
    const refused = await googleVerify('google-external-subject', external.email);
    expect(refused.status).toBe(401);
    expect((await refused.json() as any).error.code).toBe('EMAIL_OWNERSHIP_UNVERIFIED');
    expect((await googleVerify('google-external-subject', external.email, 'other.example')).status).toBe(401);
    expect(await linkedSubjects(external.email)).toEqual([]);

    // The same account links once the hd claim matches the address domain.
    expect((await googleVerify('google-external-subject', external.email, 'example.com')).status).toBe(200);
    expect(await linkedSubjects(external.email)).toEqual(['google-external-subject']);

    // A Gmail account links without hd.
    const gmail = `google-gmail-${nextSequence()}@gmail.com`;
    await env.DB.prepare('INSERT INTO signup_allowlist(email, created_at) VALUES(?, ?)')
      .bind(gmail, Math.floor(Date.now() / 1000)).run();
    expect((await emailSignIn({
      email: gmail, deviceName: 'Primary Mac', installationId: 'google-gmail-installation',
    })).status).toBe(200);
    expect((await googleVerify('google-gmail-subject', gmail)).status).toBe(200);
    expect(await linkedSubjects(gmail)).toEqual(['google-gmail-subject']);

    // Nor may such a claim pre-create the account a later email-code sign-in
    // for that address would land on.
    const fresh = `google-fresh-${nextSequence()}@example.com`;
    const notCreated = await googleVerify('google-fresh-subject', fresh);
    expect(notCreated.status).toBe(401);
    expect((await notCreated.json() as any).error.code).toBe('EMAIL_OWNERSHIP_UNVERIFIED');
    expect(await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(fresh).first()).toBeNull();
  });

  it('keeps a sign-in challenge retryable when the provider key response body fails', async () => {
    // Expire any keys cached by earlier sign-ins, then fail after HTTP headers
    // arrived: this is a transport outage while reading the key response.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_601_000);
    const originalFetch = vi.mocked(globalThis.fetch).getMockImplementation()!;
    let failBody = true;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === 'https://appleid.apple.com/auth/keys' && failBody) {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"keys":['));
            controller.error(new TypeError('Provider connection reset'));
          },
        }));
      }
      return originalFetch(input, init);
    });
    try {
      const challengeResponse = await api('auth/oidc/challenge', json({
        provider: 'apple',
        deviceName: 'Apple Mac',
        installationId: 'apple-body-failure-installation',
      }));
      expect(challengeResponse.status).toBe(200);
      const challenge = await challengeResponse.json() as any;
      const idToken = await oidcToken('apple', challenge.nonce, {
        subject: 'apple-body-failure-subject',
        email: `apple-body-failure-${nextSequence()}@example.com`,
      });
      const verify = () => api('auth/oidc/verify', json({
        provider: 'apple', challengeId: challenge.challengeId, idToken,
      }));
      const unavailable = await verify();
      expect(unavailable.status).toBe(503);
      expect((await unavailable.json() as any).error.code).toBe('IDENTITY_PROVIDER_UNAVAILABLE');
      expect(await env.DB.prepare(
        'SELECT consumed_at FROM auth_challenges WHERE id = ?',
      ).bind(challenge.challengeId).first()).toMatchObject({ consumed_at: null });

      failBody = false;
      expect((await verify()).status).toBe(200);
    } finally {
      fetchSpy.mockImplementation(originalFetch);
      clock.mockRestore();
    }
  });

  it('links a verified Apple identity to the matching existing account', async () => {
    const account = await createAccount('apple-link');
    const challengeResponse = await api('auth/oidc/challenge', json({
      provider: 'apple',
      deviceName: 'Apple Mac',
      installationId: 'apple-link-installation-two',
    }));
    const challenge = await challengeResponse.json() as any;
    const token = await oidcToken('apple', challenge.nonce, {
      subject: 'apple-linked-subject',
      email: account.email,
    });
    const linked = await api('auth/oidc/verify', json({
      provider: 'apple',
      challengeId: challenge.challengeId,
      idToken: token,
    }));
    expect(linked.status).toBe(200);
    expect((await linked.json() as any).user.id).toBe(account.user.id);
    const identity = await env.DB.prepare(
      "SELECT user_id FROM auth_identities WHERE provider = 'apple' AND subject = ?",
    ).bind('apple-linked-subject').first<any>();
    expect(identity.user_id).toBe(account.user.id);
  });

  it('completes a valid OIDC verify even when concurrent failures exhaust attempts (TOCTOU)', async () => {
    // The OIDC verify handler must reserve an attempt slot *before* the
    // network-bound verifyOidcIdToken and consume without re-checking the
    // attempts budget, so a valid token that already reserved a slot still
    // completes when concurrent garbage-token failures push attempts to
    // max_attempts during the verification I/O window. Production config
    // allows 5 verifies per challenge (RATE_LIMIT_OIDC_VERIFY_CHALLENGE default
    // 5) while max_attempts is 3; the shared test config narrows the limiter
    // to 3, which coincidentally equals max_attempts and masks the race (the
    // third attacker is throttled before bumping attempts). Restore the
    // production default so three concurrent failures actually exhaust the
    // budget while a valid verify is in flight.
    const originalChallengeLimit = (env as unknown as Env).RATE_LIMIT_OIDC_VERIFY_CHALLENGE;
    (env as unknown as Env).RATE_LIMIT_OIDC_VERIFY_CHALLENGE = '5';
    try {
      const email = `google-toctou-${nextSequence()}@example.com`;
      const challengeResponse = await api('auth/oidc/challenge', json({
        provider: 'google',
        deviceName: 'TOCTOU Mac',
        installationId: 'toctou-installation',
      }));
      expect(challengeResponse.status).toBe(200);
      const challenge = await challengeResponse.json() as any;
      const validToken = await oidcToken('google', challenge.nonce, {
        subject: 'google-toctou-subject',
        email,
        hd: 'example.com',
      });

      // Park the victim inside verifyOidcIdToken's signature check. The victim
      // has already passed JWT parsing and reached crypto.subtle.verify;
      // garbage attacker tokens ('x'.repeat(101)) fail the 3-part split before
      // signature verification, so only the victim parks. This models the
      // network I/O window of verifyOidcIdToken without depending on JWKS
      // cache state.
      const realVerify = crypto.subtle.verify.bind(crypto.subtle);
      let releaseVerify!: () => void;
      let notifyParked!: () => void;
      const parked = new Promise<void>((resolve) => { notifyParked = resolve; });
      const gate = new Promise<void>((resolve) => { releaseVerify = resolve; });
      let firstCall = true;
      const verifySpy = vi.spyOn(crypto.subtle, 'verify').mockImplementation(
        async (algorithm: any, key: any, signature: any, data: any) => {
          if (firstCall) {
            firstCall = false;
            notifyParked();
            await gate;
          }
          return realVerify(algorithm, key, signature, data);
        },
      );

      try {
        const victimPromise = api('auth/oidc/verify', json({
          provider: 'google',
          challengeId: challenge.challengeId,
          idToken: validToken,
        }));
        await parked;

        const attackerResponses = await Promise.all(Array.from({ length: 3 }, () =>
          api('auth/oidc/verify', json({
            provider: 'google',
            challengeId: challenge.challengeId,
            idToken: 'x'.repeat(101),
          })),
        ));
        expect(attackerResponses.map((response) => response.status).sort())
          .toEqual([401, 401, 401]);

        releaseVerify();
        const victimResponse = await victimPromise;
        expect(victimResponse.status).toBe(200);
        expect((await victimResponse.json() as any).user.email).toBe(email);

        const row = await env.DB.prepare(
          'SELECT attempts, consumed_at FROM auth_challenges WHERE id = ?',
        ).bind(challenge.challengeId).first<any>();
        expect(row.attempts).toBe(3);
        expect(row.consumed_at).not.toBeNull();

        // Replay of the now-consumed challenge must still fail (no bypass).
        expect((await api('auth/oidc/verify', json({
          provider: 'google',
          challengeId: challenge.challengeId,
          idToken: validToken,
        }))).status).toBe(401);
      } finally {
        verifySpy.mockRestore();
      }
    } finally {
      (env as unknown as Env).RATE_LIMIT_OIDC_VERIFY_CHALLENGE = originalChallengeLimit;
    }
  });
});
