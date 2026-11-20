import crypto from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFacebookAuthorizationUrl,
  buildGoogleAuthorizationUrl,
  computeFacebookAppSecretProof,
  consumeAndVerifyOAuthStateToken,
  createOAuthStateToken,
  exchangeAndVerifyFacebookCode,
  exchangeAndVerifyGoogleCode,
  generatePkcePair,
  resetOAuthRuntimeCachesForTests,
  signPendingLinkToken,
  signPendingSocialEmailToken,
  verifyGoogleIdToken,
  verifyPendingLinkToken,
  verifyPendingSocialEmailToken,
} from './oauth.service.ts';

function createSignedJwt(
  payload: Record<string, unknown>,
  privateKey: crypto.KeyObject,
  kid = 'test-google-kid-1',
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey).toString('base64url');
  return `${header}.${body}.${signature}`;
}

describe('NOVARA OAuth 2.0 / OIDC security service', () => {
  beforeEach(() => {
    resetOAuthRuntimeCachesForTests();
  });

  it('generates RFC 7636 S256 PKCE verifier and matching challenge', () => {
    const pkce = generatePkcePair();
    assert.ok(pkce.codeVerifier.length >= 43);
    assert.equal(pkce.method, 'S256');
    const recomputed = crypto.createHash('sha256').update(pkce.codeVerifier).digest('base64url');
    assert.equal(pkce.codeChallenge, recomputed);
  });

  it('builds Google auth URL with PKCE S256 challenge and OIDC nonce', () => {
    const url = new URL(
      buildGoogleAuthorizationUrl({
        clientId: 'google-client-123',
        redirectUri: 'https://ais-dev-example.run.app/api/auth/oauth/google/callback',
        state: 'sealed-state-xyz',
        codeChallenge: 'pkce-challenge-abc',
        oidcNonce: 'oidc-nonce-999',
      }),
    );
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('code_challenge'), 'pkce-challenge-abc');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('nonce'), 'oidc-nonce-999');
    assert.equal(url.searchParams.get('scope'), 'openid email profile');
  });

  it('seals, verifies, and enforces single-use replay protection on OAuth state tokens', () => {
    const now = 1_750_000_000_000;
    const secret = 'test-super-secret-key-for-oauth-tests';
    const replayStore = new Map<string, number>();

    const token = createOAuthStateToken({
      provider: 'google',
      mode: 'popup',
      intent: 'link',
      linkUserId: 'user-42',
      returnTo: '/account/security',
      origin: 'https://ais-dev-example.run.app',
      codeVerifier: 'verifier-secret-value',
      oidcNonce: 'nonce-123',
      cookieNonce: 'cookie-abc',
      secret,
      nowMs: now,
    });

    const verified = consumeAndVerifyOAuthStateToken({
      stateToken: token,
      expectedProvider: 'google',
      cookieNonce: 'cookie-abc',
      secret,
      nowMs: now + 5_000,
      replayStore,
    });

    assert.equal(verified.intent, 'link');
    assert.equal(verified.linkUserId, 'user-42');
    assert.equal(verified.codeVerifier, 'verifier-secret-value');
    assert.equal(verified.returnTo, '/account/security');

    // Replaying the exact same state token must fail
    assert.throws(
      () =>
        consumeAndVerifyOAuthStateToken({
          stateToken: token,
          expectedProvider: 'google',
          cookieNonce: 'cookie-abc',
          secret,
          nowMs: now + 6_000,
          replayStore,
        }),
      /already been used/,
    );

    // Wrong cookie nonce must fail CSRF check
    assert.throws(
      () =>
        consumeAndVerifyOAuthStateToken({
          stateToken: token,
          expectedProvider: 'google',
          cookieNonce: 'wrong-cookie',
          secret,
          nowMs: now + 6_000,
          replayStore: new Map(),
        }),
      /CSRF/,
    );
  });

  it('verifies Google OIDC RS256 ID token against JWKS and checks audience, issuer, exp, nonce, and email_verified', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicJwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'g-key-1', use: 'sig', alg: 'RS256' };
    const nowMs = 1_750_000_000_000;
    const nowSec = Math.floor(nowMs / 1000);

    const mockFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
        });
      }
      if (url === 'https://oauth2.googleapis.com/token') {
        const idToken = createSignedJwt(
          {
            iss: 'https://accounts.google.com',
            aud: 'google-client-id',
            sub: 'google-sub-777',
            email: 'Mahim.Hasan@Gmail.COM',
            email_verified: true,
            name: 'Mahim Hasan',
            given_name: 'Mahim',
            family_name: 'Hasan',
            picture: 'https://lh3.googleusercontent.com/a/photo.jpg',
            nonce: 'expected-oidc-nonce',
            iat: nowSec - 10,
            exp: nowSec + 3600,
          },
          privateKey,
          'g-key-1',
        );
        return new Response(JSON.stringify({ access_token: 'g-access', id_token: idToken }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const verified = await exchangeAndVerifyGoogleCode({
      code: 'auth-code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'https://ais-dev-example.run.app/api/auth/oauth/google/callback',
      expectedNonce: 'expected-oidc-nonce',
      clientId: 'google-client-id',
      clientSecret: 'google-secret',
      fetchFn: mockFetch,
      nowMs,
    });

    assert.equal(verified.providerUserId, 'google-sub-777');
    assert.equal(verified.email, 'mahim.hasan@gmail.com');
    assert.equal(verified.givenName, 'Mahim');
    assert.equal(verified.familyName, 'Hasan');
    assert.equal(verified.picture, 'https://lh3.googleusercontent.com/a/photo.jpg');

    // Reject mismatched audience
    const wrongAudToken = createSignedJwt(
      {
        iss: 'https://accounts.google.com',
        aud: 'wrong-client',
        sub: 'google-sub-777',
        email: 'mahim@gmail.com',
        email_verified: true,
        nonce: 'expected-oidc-nonce',
        exp: nowSec + 3600,
      },
      privateKey,
      'g-key-1',
    );
    await assert.rejects(
      () =>
        verifyGoogleIdToken({
          idToken: wrongAudToken,
          clientId: 'google-client-id',
          expectedNonce: 'expected-oidc-nonce',
          fetchFn: mockFetch,
          nowMs,
        }),
      /audience/,
    );

    // Reject unverified email
    const unverifiedEmailToken = createSignedJwt(
      {
        iss: 'https://accounts.google.com',
        aud: 'google-client-id',
        sub: 'google-sub-777',
        email: 'mahim@gmail.com',
        email_verified: false,
        nonce: 'expected-oidc-nonce',
        exp: nowSec + 3600,
      },
      privateKey,
      'g-key-1',
    );
    await assert.rejects(
      () =>
        verifyGoogleIdToken({
          idToken: unverifiedEmailToken,
          clientId: 'google-client-id',
          expectedNonce: 'expected-oidc-nonce',
          fetchFn: mockFetch,
          nowMs,
        }),
      /verified/,
    );
  });

  it('verifies Facebook OAuth with debug_token + appsecret_proof and handles missing email without fabricating addresses', async () => {
    const fbUrl = new URL(
      buildFacebookAuthorizationUrl({
        appId: 'fb-app-1',
        redirectUri: 'https://ais-dev-example.run.app/api/auth/oauth/facebook/callback',
        state: 'fb-state',
      }),
    );
    assert.equal(fbUrl.searchParams.get('scope'), 'email,public_profile');

    const expectedProof = computeFacebookAppSecretProof('fb-token-99', 'fb-secret-xyz');
    let capturedMeProof = '';

    const mockFetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'fb-token-99' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.pathname === '/debug_token') {
        return new Response(
          JSON.stringify({ data: { is_valid: true, app_id: 'fb-app-1', user_id: 'fb-user-888' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.pathname.endsWith('/me')) {
        capturedMeProof = url.searchParams.get('appsecret_proof') || '';
        return new Response(
          JSON.stringify({
            id: 'fb-user-888',
            name: 'Nadia Islam',
            first_name: 'Nadia',
            last_name: 'Islam',
            // Intentionally omitted email to verify non-fabrication handling
            picture: { data: { url: 'https://platform-lookaside.fbsbx.com/pic.jpg', is_silhouette: false } },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const fbProfile = await exchangeAndVerifyFacebookCode({
      code: 'fb-code-1',
      redirectUri: 'https://ais-dev-example.run.app/api/auth/oauth/facebook/callback',
      appId: 'fb-app-1',
      appSecret: 'fb-secret-xyz',
      fetchFn: mockFetch,
    });

    assert.equal(capturedMeProof, expectedProof);
    assert.equal(fbProfile.providerUserId, 'fb-user-888');
    assert.equal(fbProfile.email, null);
    assert.equal(fbProfile.emailMissing, true);
    assert.equal(fbProfile.picture, 'https://platform-lookaside.fbsbx.com/pic.jpg');
  });

  it('signs and verifies pending social email and account-link confirmation tokens safely', () => {
    const secret = 'pending-challenge-secret-key';
    const now = 1_750_000_000_000;

    const emailChallenge = signPendingSocialEmailToken(
      {
        provider: 'facebook',
        providerUserId: 'fb-user-888',
        name: 'Nadia Islam',
        givenName: 'Nadia',
        familyName: 'Islam',
        picture: 'https://platform-lookaside.fbsbx.com/pic.jpg',
        returnTo: '/checkout',
      },
      secret,
      now,
    );
    const decodedChallenge = verifyPendingSocialEmailToken(emailChallenge, secret, now + 1000);
    assert.equal(decodedChallenge.providerUserId, 'fb-user-888');
    assert.equal(decodedChallenge.returnTo, '/checkout');

    const linkToken = signPendingLinkToken(
      {
        userId: 'user-55',
        provider: 'google',
        providerUserId: 'google-sub-55',
        email: 'nadia@example.com',
        name: 'Nadia Islam',
        givenName: 'Nadia',
        familyName: 'Islam',
        picture: 'https://lh3.googleusercontent.com/pic.jpg',
        emailVerified: true,
        returnTo: '/account',
      },
      secret,
      now,
    );
    const decodedLink = verifyPendingLinkToken(linkToken, secret, now + 1000);
    assert.equal(decodedLink.userId, 'user-55');
    assert.equal(decodedLink.provider, 'google');
  });
});
