import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { env, integrations } from '../../config/env';
import { createExpressApp } from '../../app';
import { signAuthToken } from '../../middleware/auth.middleware';
import { UserModel } from '../users/user.model';
import { HomepageConfigModel } from '../cms/cms.model';
import { buildOAuthCallbackHtml } from './auth.controller';
import { AuthSessionModel, UserAuthProviderModel } from './authIdentity.model';
import {
  confirmOAuthLinkAccount,
  resolveOrChallengeOAuthUser,
  unlinkProviderForUser,
} from './auth.service';

async function withHttpServer(fn: (baseUrl: string) => Promise<void>) {
  const app = createExpressApp();
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function withMockReadyDb(fn: () => Promise<void>) {
  const desc = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
  try {
    await fn();
  } finally {
    if (desc) {
      Object.defineProperty(mongoose.connection, 'readyState', desc);
    } else {
      Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });
    }
  }
}

function chainableQuery<T>(result: T) {
  return {
    select() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
    then<TResult1 = T, TResult2 = never>(
      onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
  };
}

test('GET /api/auth/providers returns 200 without DB and includes Dev + Shared Cloud Run callback URLs', async () => {
  await withHttpServer(async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/api/auth/providers`);
    assert.equal(resp.status, 200);
    const body = (await resp.json()) as {
      ok: boolean;
      providers: {
        emailPassword: boolean;
        google: boolean;
        facebook: boolean;
        googleConfigured: boolean;
        facebookConfigured: boolean;
      };
      callbacks: {
        google: { devCallbackUrl: string; sharedCallbackUrl: string };
        facebook: { devCallbackUrl: string; sharedCallbackUrl: string };
      };
      branding: { effectiveBrandName: string; loginTitle: string };
    };

    const devOrigin = env.APP_URL.replace(/\/$/, '');
    const expectedSharedOrigin = devOrigin.includes('ais-dev-')
      ? devOrigin.replace('ais-dev-', 'ais-pre-')
      : env.CLIENT_URL && env.CLIENT_URL !== devOrigin
        ? env.CLIENT_URL.replace(/\/$/, '')
        : devOrigin;

    assert.equal(body.ok, true);
    assert.equal(body.providers.emailPassword, true);
    assert.equal(typeof body.providers.googleConfigured, 'boolean');
    assert.equal(typeof body.providers.facebookConfigured, 'boolean');
    assert.equal(body.callbacks.google.devCallbackUrl, `${devOrigin}/api/auth/oauth/google/callback`);
    assert.equal(body.callbacks.google.sharedCallbackUrl, `${expectedSharedOrigin}/api/auth/oauth/google/callback`);
    assert.equal(body.callbacks.facebook.devCallbackUrl, `${devOrigin}/api/auth/oauth/facebook/callback`);
    assert.equal(body.callbacks.facebook.sharedCallbackUrl, `${expectedSharedOrigin}/api/auth/oauth/facebook/callback`);
    assert.ok(body.branding.effectiveBrandName.length > 0);
  });
});

test('POST /api/auth/identify normalizes valid email and returns HTTP 400 for malformed email without enumeration', async () => {
  await withHttpServer(async (baseUrl) => {
    const validResp = await fetch(`${baseUrl}/api/auth/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '  Alex.Customer@Example.COM  ' }),
    });
    assert.equal(validResp.status, 200);
    const validBody = (await validResp.json()) as { ok: boolean; email: string; step: string };
    assert.equal(validBody.ok, true);
    assert.equal(validBody.email, 'alex.customer@example.com');
    assert.equal(validBody.step, 'credentials');

    const badResp = await fetch(`${baseUrl}/api/auth/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    assert.equal(badResp.status, 400);
  });
});

test('OAuth safe account linking requires explicit password confirmation instead of silent auto-linking', async () => {
  const passwordHash = await bcrypt.hash('NovaraPass123', 6);
  const localUser = {
    _id: '507f1f77bcf86cd799439011',
    name: 'Tasnim Rahman',
    givenName: 'Tasnim',
    familyName: 'Rahman',
    email: 'tasnim@example.com',
    role: 'customer',
    status: 'active',
    isVerified: true,
    passwordHash,
    authProvider: 'local',
    initialAuthProvider: 'local',
    oauthProviders: {} as { googleId?: string; facebookId?: string },
    avatarUrl: '',
    avatarSources: { google: '', facebook: '', uploaded: '' },
    saveCalled: false,
    async save() {
      this.saveCalled = true;
      return this;
    },
  };

  const origFindOne = UserModel.findOne;
  const origFindById = UserModel.findById;

  try {
    (UserModel as unknown as Record<string, unknown>).findOne = (query: Record<string, unknown>) => {
      if ('oauthProviders.googleId' in query) {
        return chainableQuery(
          localUser.oauthProviders.googleId === query['oauthProviders.googleId'] ? localUser : null,
        );
      }
      if (query.email === 'tasnim@example.com') {
        return chainableQuery(localUser);
      }
      return chainableQuery(null);
    };
    (UserModel as unknown as Record<string, unknown>).findById = (id: string) =>
      chainableQuery(id === localUser._id ? localUser : null);

    // Step 1: OAuth sign-in matching existing local email must NOT auto-link; returns link_required
    const challenge = await resolveOrChallengeOAuthUser({
      provider: 'google',
      providerId: 'google-sub-999',
      email: 'tasnim@example.com',
      name: 'Tasnim Rahman',
      picture: 'https://lh3.googleusercontent.com/a/photo',
      emailVerified: true,
    });

    assert.equal(challenge.status, 'link_required');
    if (challenge.status !== 'link_required') throw new Error('Expected link_required');
    assert.equal(challenge.provider, 'google');
    assert.equal(challenge.existingHasPassword, true);
    assert.equal(challenge.existingInitialProvider, 'local');
    assert.equal(localUser.saveCalled, false);

    // Step 2: Wrong password rejects linking cleanly
    await assert.rejects(
      confirmOAuthLinkAccount({
        linkToken: challenge.pendingLinkToken,
        password: 'WrongPassword99',
      }),
      /Incorrect password/,
    );
    assert.equal(localUser.oauthProviders.googleId, undefined);

    // Step 3: Correct password links Google while preserving initialAuthProvider: 'local'
    const linked = await confirmOAuthLinkAccount({
      linkToken: challenge.pendingLinkToken,
      password: 'NovaraPass123',
    });

    assert.equal(localUser.saveCalled, true);
    assert.equal(localUser.oauthProviders.googleId, 'google-sub-999');
    assert.equal(linked.user.initialAuthProvider, 'local');
    assert.equal(linked.user.linkedProviders?.google, true);
    assert.equal(linked.user.linkedProviders?.local, true);
    assert.ok(linked.token.length > 20);
  } finally {
    UserModel.findOne = origFindOne;
    UserModel.findById = origFindById;
  }
});

test('unlinkProviderForUser blocks unlinking the last sign-in method and allows unlinking when another method exists', async () => {
  const socialOnlyUser = {
    _id: '507f1f77bcf86cd799439022',
    name: 'Google Buyer',
    email: 'buyer@example.com',
    role: 'customer',
    status: 'active',
    isVerified: true,
    passwordHash: undefined as string | undefined,
    initialAuthProvider: 'google',
    oauthProviders: { googleId: 'g-only' } as { googleId?: string; facebookId?: string },
    avatarUrl: 'https://lh3.googleusercontent.com/a/g-only',
    avatarSources: { google: 'https://lh3.googleusercontent.com/a/g-only', facebook: '', uploaded: '' },
    async save() {
      return this;
    },
  };

  const origFindById = UserModel.findById;
  try {
    (UserModel as unknown as Record<string, unknown>).findById = () => chainableQuery(socialOnlyUser);

    await assert.rejects(
      unlinkProviderForUser(socialOnlyUser._id, 'google'),
      /before unlinking your only sign-in method/,
    );

    // Adding a password enables safe unlinking
    socialOnlyUser.passwordHash = 'hashed-pw';
    const serialized = await unlinkProviderForUser(socialOnlyUser._id, 'google');
    assert.equal(serialized.linkedProviders?.google, false);
    assert.equal(serialized.linkedProviders?.local, true);
    assert.equal(serialized.initialAuthProvider, 'google');
  } finally {
    UserModel.findById = origFindById;
  }
});

test('authenticateRequired rejects revoked AuthSession tokens and admin analytics requires admin permission', async () => {
  const origSessionFindOne = AuthSessionModel.findOne;
  const origUserFindById = UserModel.findById;
  const origProviderFind = UserAuthProviderModel.find;

  try {
    await withMockReadyDb(async () => {
      const revokedSid = 'sid-revoked-001';
      const activeSid = 'sid-active-002';

      (AuthSessionModel as unknown as Record<string, unknown>).findOne = ({ sessionId }: { sessionId: string }) =>
        chainableQuery(
          sessionId === revokedSid
            ? { sessionId: revokedSid, revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }
            : { sessionId: activeSid, revokedAt: null, expiresAt: new Date(Date.now() + 60_000), lastSeenAt: new Date() },
        );

      const customerDoc = {
        _id: '507f1f77bcf86cd799439033',
        name: 'Regular Customer',
        email: 'customer@example.com',
        role: 'customer',
        status: 'active',
        isVerified: true,
        customPermissions: [],
      };
      (UserModel as unknown as Record<string, unknown>).findById = () => chainableQuery(customerDoc);

      const revokedJwt = signAuthToken(
        { _id: customerDoc._id, role: 'customer', email: customerDoc.email },
        { sessionId: revokedSid },
      );
      const activeCustomerJwt = signAuthToken(
        { _id: customerDoc._id, role: 'customer', email: customerDoc.email },
        { sessionId: activeSid },
      );

      await withHttpServer(async (baseUrl) => {
        // Revoked session rejected with 401 SESSION_REVOKED
        const revResp = await fetch(`${baseUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${revokedJwt}` },
        });
        assert.equal(revResp.status, 401);
        const revBody = (await revResp.json()) as { code: string };
        assert.equal(revBody.code, 'SESSION_REVOKED');

        // Unauthenticated admin analytics call returns 401
        const unauthAdmin = await fetch(`${baseUrl}/api/admin/users/authentication-stats`);
        assert.equal(unauthAdmin.status, 401);

        // Customer role calling admin analytics returns 403 FORBIDDEN
        const forbiddenAdmin = await fetch(`${baseUrl}/api/admin/users/authentication-stats`, {
          headers: { Authorization: `Bearer ${activeCustomerJwt}` },
        });
        assert.equal(forbiddenAdmin.status, 403);
      });
    });
  } finally {
    AuthSessionModel.findOne = origSessionFindOne;
    UserModel.findById = origUserFindById;
    UserAuthProviderModel.find = origProviderFind;
  }
});

test('Express emits Cross-Origin-Opener-Policy: same-origin-allow-popups and no-store cache headers on /api/auth', async () => {
  await withHttpServer(async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/api/auth/providers`);
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
    assert.ok(resp.headers.get('cache-control')?.includes('no-store'));
  });
});

test('buildOAuthCallbackHtml enforces strict targetOrigin, BroadcastChannel fallback, XSS escaping, and never redirects popup to website', () => {
  const popupHtml = buildOAuthCallbackHtml(
    {
      type: 'OAUTH_AUTH_SUCCESS',
      provider: 'google',
      user: {
        id: 'u1',
        name: 'Amina </script><script>alert(1)</script>',
        givenName: 'Amina',
        familyName: 'Test',
        email: 'amina@example.com',
        phone: '',
        avatarUrl: '',
        avatarSources: { google: '', facebook: '', uploaded: '' },
        walletBalance: 0,
        role: 'customer',
        customPermissions: [],
        isVerified: true,
        status: 'active',
        authProvider: 'google',
        initialAuthProvider: 'google',
        linkedProviders: { local: false, google: true, facebook: false },
        notificationPrefs: { orderUpdates: true, promotions: false, backInStock: true },
        createdAt: undefined,
      },
      token: 'jwt-token-value',
      returnTo: '/',
    },
    { targetOrigin: 'https://shop.novara.test', mode: 'popup' },
  );

  assert.equal(popupHtml.includes("postMessage(msg, '*')"), false);
  assert.equal(popupHtml.includes('postMessage(msg, "*")'), false);
  assert.equal(popupHtml.includes('https://shop.novara.test'), true);
  assert.equal(popupHtml.includes('novara_oauth_channel'), true);
  assert.equal(popupHtml.includes('window.close()'), true);
  assert.equal(popupHtml.includes('</script><script>'), false);
  assert.equal(popupHtml.includes('\\u003c/script>'), true);
  // In popup mode, fallback redirect branch only executes when mode === 'redirect'
  assert.equal(popupHtml.includes("if (mode === 'redirect' && !deliveredToOpener)"), true);
  assert.equal(popupHtml.includes('window.location.href ='), false);
});

test('POST /api/auth/register & /api/auth/login authenticate with bcrypt hash, cookie, and duplicate/invalid protections', async () => {
  const origUserFindOne = UserModel.findOne;
  const origUserCreate = UserModel.create;
  const origUserFindById = UserModel.findById;
  const origSessionCreate = AuthSessionModel.create;
  const origConfigFindOne = HomepageConfigModel.findOne;
  const origProviderFindOneAndUpdate = UserAuthProviderModel.findOneAndUpdate;

  const storedUsers: Array<Record<string, unknown>> = [];

  try {
    await withMockReadyDb(async () => {
      (HomepageConfigModel as unknown as Record<string, unknown>).findOne = () => chainableQuery(null);
      (AuthSessionModel as unknown as Record<string, unknown>).create = async (doc: Record<string, unknown>) => ({
        ...doc,
        _id: 'sess-1',
      });
      (UserAuthProviderModel as unknown as Record<string, unknown>).findOneAndUpdate = async () => ({});
      (UserModel as unknown as Record<string, unknown>).findOne = (query: Record<string, unknown>) => {
        const match = storedUsers.find((u) => u.email === query.email) || null;
        return chainableQuery(match);
      };
      (UserModel as unknown as Record<string, unknown>).findById = (id: string) =>
        chainableQuery(storedUsers.find((u) => u._id === id) || null);
      (UserModel as unknown as Record<string, unknown>).create = async (doc: Record<string, unknown>) => {
        const created = {
          ...doc,
          _id: '507f1f77bcf86cd799439088',
          status: 'active',
          role: 'customer',
          oauthProviders: {},
          avatarSources: { google: '', facebook: '', uploaded: '' },
          async save() {
            return this;
          },
        };
        storedUsers.push(created);
        return created;
      };

      await withHttpServer(async (baseUrl) => {
        const regResp = await fetch(`${baseUrl}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Nadia Karim',
            email: 'Nadia.Karim@Example.com',
            password: 'NovaraPass2026',
          }),
        });
        assert.equal(regResp.status, 201);
        const regBody = (await regResp.json()) as {
          ok: boolean;
          requiresVerification: boolean;
          token: string;
          user: { id: string; email: string; name: string; role: string };
        };
        assert.equal(regBody.ok, true);
        assert.equal(regBody.requiresVerification, false);
        assert.equal(regBody.user.email, 'nadia.karim@example.com');
        assert.equal(regBody.user.name, 'Nadia Karim');
        assert.ok(regBody.token.length > 20);
        assert.ok(regResp.headers.get('set-cookie')?.includes('novara_token='));
        assert.notEqual(storedUsers[0].passwordHash, 'NovaraPass2026');

        // Duplicate registration rejects with 409 EMAIL_EXISTS
        const dupResp = await fetch(`${baseUrl}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Nadia Karim',
            email: 'nadia.karim@example.com',
            password: 'NovaraPass2026',
          }),
        });
        assert.equal(dupResp.status, 409);
        const dupBody = (await dupResp.json()) as { code: string };
        assert.equal(dupBody.code, 'EMAIL_EXISTS');

        // Wrong password login rejects with 401
        const badLoginResp = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'nadia.karim@example.com',
            password: 'WrongPassword1',
          }),
        });
        assert.equal(badLoginResp.status, 401);

        // Correct password login succeeds with cookie and token
        const loginResp = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'nadia.karim@example.com',
            password: 'NovaraPass2026',
          }),
        });
        assert.equal(loginResp.status, 200);
        const loginBody = (await loginResp.json()) as { ok: boolean; user: { email: string }; token: string };
        assert.equal(loginBody.ok, true);
        assert.equal(loginBody.user.email, 'nadia.karim@example.com');
        assert.ok(loginBody.token.length > 20);
        assert.ok(loginResp.headers.get('set-cookie')?.includes('novara_token='));
      });
    });
  } finally {
    UserModel.findOne = origUserFindOne;
    UserModel.create = origUserCreate;
    UserModel.findById = origUserFindById;
    AuthSessionModel.create = origSessionCreate;
    HomepageConfigModel.findOne = origConfigFindOne;
    UserAuthProviderModel.findOneAndUpdate = origProviderFindOneAndUpdate;
  }
});

test('Google OAuth popup URL -> callback flow issues session cookie and popup-safe closing HTML', async () => {
  const prevGoogleEnabled = integrations.googleOAuth;
  const prevClientId = env.GOOGLE_CLIENT_ID;
  const prevClientSecret = env.GOOGLE_CLIENT_SECRET;
  const origFetch = globalThis.fetch;
  const origUserFindOne = UserModel.findOne;
  const origUserCreate = UserModel.create;
  const origSessionCreate = AuthSessionModel.create;
  const origProviderFindOne = UserAuthProviderModel.findOne;
  const origProviderFindOneAndUpdate = UserAuthProviderModel.findOneAndUpdate;
  const origConfigFindOne = HomepageConfigModel.findOne;

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'test-kid-1', alg: 'RS256', use: 'sig' };
  const storedUsers: Array<Record<string, unknown>> = [];

  try {
    (integrations as Record<string, boolean>).googleOAuth = true;
    (env as Record<string, unknown>).GOOGLE_CLIENT_ID = 'test-google-client-id';
    (env as Record<string, unknown>).GOOGLE_CLIENT_SECRET = 'test-google-client-secret';

    await withMockReadyDb(async () => {
      (HomepageConfigModel as unknown as Record<string, unknown>).findOne = () => chainableQuery(null);
      (AuthSessionModel as unknown as Record<string, unknown>).create = async (doc: Record<string, unknown>) => ({
        ...doc,
        _id: 'oauth-sess-1',
      });
      (UserAuthProviderModel as unknown as Record<string, unknown>).findOne = () => chainableQuery(null);
      (UserAuthProviderModel as unknown as Record<string, unknown>).findOneAndUpdate = async () => ({});
      (UserModel as unknown as Record<string, unknown>).findOne = (query: Record<string, unknown>) => {
        const match =
          storedUsers.find(
            (u) =>
              u.email === query.email ||
              (u.oauthProviders as Record<string, unknown> | undefined)?.googleId === query['oauthProviders.googleId'],
          ) || null;
        return chainableQuery(match);
      };
      (UserModel as unknown as Record<string, unknown>).create = async (doc: Record<string, unknown>) => {
        const created = {
          ...doc,
          _id: '507f1f77bcf86cd799439099',
          status: 'active',
          role: 'customer',
          async save() {
            return this;
          },
        };
        storedUsers.push(created);
        return created;
      };

      await withHttpServer(async (baseUrl) => {
        // 1. Request OAuth authorization URL
        const urlResp = await fetch(`${baseUrl}/api/auth/oauth/google/url?returnTo=${encodeURIComponent('/')}`);
        assert.equal(urlResp.status, 200);
        const urlBody = (await urlResp.json()) as { ok: boolean; url: string; callbackOrigin: string };
        assert.equal(urlBody.ok, true);
        assert.equal(urlBody.callbackOrigin, baseUrl);
        const stateCookie = urlResp.headers.get('set-cookie')?.split(';')[0] || '';
        assert.ok(stateCookie.includes('novara_oauth_state='));

        const parsedGoogleUrl = new URL(urlBody.url);
        const stateToken = parsedGoogleUrl.searchParams.get('state') || '';
        const oidcNonce = parsedGoogleUrl.searchParams.get('nonce') || '';
        assert.ok(stateToken.length > 20);
        assert.ok(oidcNonce.length > 10);

        // Sign a valid Google OIDC ID token with test RSA keypair
        const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-kid-1', typ: 'JWT' })).toString('base64url');
        const nowSec = Math.floor(Date.now() / 1000);
        const payloadB64 = Buffer.from(
          JSON.stringify({
            iss: 'https://accounts.google.com',
            aud: 'test-google-client-id',
            sub: 'google-user-sub-777',
            email: 'google.shopper@example.com',
            email_verified: true,
            name: 'Google Shopper',
            given_name: 'Google',
            family_name: 'Shopper',
            nonce: oidcNonce,
            iat: nowSec,
            exp: nowSec + 300,
          }),
        ).toString('base64url');
        const sig = crypto.sign('RSA-SHA256', Buffer.from(`${headerB64}.${payloadB64}`), privateKey).toString('base64url');
        const idToken = `${headerB64}.${payloadB64}.${sig}`;

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
          if (url.startsWith('https://oauth2.googleapis.com/token')) {
            return new Response(JSON.stringify({ id_token: idToken, access_token: 'mock-access' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')) {
            return new Response(JSON.stringify({ keys: [publicJwk] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' },
            });
          }
          return origFetch(input, init);
        }) as typeof fetch;

        // 2. Hit Google OAuth callback endpoint with code, state, and state cookie
        const cbResp = await fetch(
          `${baseUrl}/api/auth/oauth/google/callback?code=auth-code-123&state=${encodeURIComponent(stateToken)}`,
          { headers: { Cookie: stateCookie } },
        );
        assert.equal(cbResp.status, 200);
        assert.equal(cbResp.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
        assert.ok(cbResp.headers.get('cache-control')?.includes('no-store'));
        assert.ok(cbResp.headers.get('set-cookie')?.includes('novara_token='));

        const html = await cbResp.text();
        assert.ok(html.includes('OAUTH_AUTH_SUCCESS'));
        assert.ok(html.includes('google.shopper@example.com'));
        assert.ok(html.includes('window.close()'));
        assert.ok(html.includes(baseUrl));
        assert.equal(html.includes("postMessage(msg, '*')"), false);
        assert.equal(storedUsers.length, 1);
      });
    });
  } finally {
    globalThis.fetch = origFetch;
    (integrations as Record<string, boolean>).googleOAuth = prevGoogleEnabled;
    (env as Record<string, unknown>).GOOGLE_CLIENT_ID = prevClientId;
    (env as Record<string, unknown>).GOOGLE_CLIENT_SECRET = prevClientSecret;
    UserModel.findOne = origUserFindOne;
    UserModel.create = origUserCreate;
    AuthSessionModel.create = origSessionCreate;
    UserAuthProviderModel.findOne = origProviderFindOne;
    UserAuthProviderModel.findOneAndUpdate = origProviderFindOneAndUpdate;
    HomepageConfigModel.findOne = origConfigFindOne;
  }
});
